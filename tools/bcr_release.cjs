// release-please's public strategy hook still uses a SemVer-only Version class.
// Replace that class before loading the pinned library, within this process only.
const versionModule = require('release-please/build/src/version.js');
const UpstreamVersion = versionModule.Version;

class BcrVersion extends UpstreamVersion {
  static parse(value) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.bcr\.([1-9]\d*))?$/.exec(value);
    if (!match || match.slice(1).some(part => part !== undefined && !Number.isSafeInteger(Number(part)))) {
      throw new Error(`Invalid BCR release version: ${value}`);
    }
    const version = new BcrVersion(...match.slice(1, 4).map(Number));
    version.revision = match[4] === undefined ? 0 : Number(match[4]);
    return version;
  }

  toString() {
    return `${this.major}.${this.minor}.${this.patch}${this.revision ? `.bcr.${this.revision}` : ''}`;
  }

  compare(other) {
    for (const key of ['major', 'minor', 'patch', 'revision']) {
      const difference = (this[key] || 0) - (other[key] || 0);
      if (difference) return Math.sign(difference);
    }
    return 0;
  }
}

versionModule.Version = class extends BcrVersion {
  static parse(value) {
    // GitHub-style PR bodies pass the entire dated changelog heading and notes
    // to Version.parse, rather than just the version token.
    const heading = /^(\S+) \(\d{4}-\d{2}-\d{2}\)(?:\n[\s\S]*)?$/.exec(value);
    return BcrVersion.parse(heading ? heading[1] : value);
  }
};

const {GitHub, Manifest, registerReleaseType, registerVersioningStrategy} = require('release-please');
const {Bazel} = require('release-please/build/src/strategies/bazel.js');

function selectVersion(metadata) {
  const versions = metadata.versions.map(value => BcrVersion.parse(value));
  versions.sort((a, b) => b.compare(a));
  const selected = versions[0];
  if (!selected || Object.hasOwn(metadata.yanked_versions || {}, selected.toString())) {
    throw new Error('Latest BCR version must exist and must not be yanked');
  }
  return selected;
}

function registerBcrStrategy(target, metadata = {versions: [target.toString()]}) {
  registerVersioningStrategy('bcr', () => ({
    bump(current) {
      if (target.compare(current) <= 0) {
        throw new Error(`BCR version ${target} must be newer than ${current}`);
      }
      return target;
    },
  }));
  class BcrBazel extends Bazel {
    // Do not allow Release-As commit footers to bypass registry selection.
    async buildNewVersion(commits, latestRelease) {
      return this.versioningStrategy.bump(
        latestRelease?.tag.version || BcrVersion.parse('0.0.0'), commits,
      );
    }

    async buildReleases(pullRequest, options) {
      const releases = await super.buildReleases(pullRequest, options);
      for (const release of releases) {
        const version = release.tag.version.toString();
        if (!metadata.versions.includes(version) || Object.hasOwn(metadata.yanked_versions || {}, version)) {
          throw new Error(`Cannot release unregistered or yanked BCR version ${version}`);
        }
      }
      return releases;
    }
  }
  registerReleaseType('bcr-bazel', options => new BcrBazel(options));
}

async function run(github, branch) {
  const contents = await github.getFileContentsOnBranch('bcr/metadata.json', branch);
  const metadata = JSON.parse(contents.parsedContent);
  const target = selectVersion(metadata);
  registerBcrStrategy(target, metadata);
  const loadManifest = () => Manifest.fromManifest(
    github, branch, 'release-please-config.json', '.release-please-manifest.json',
  );
  const manifest = await loadManifest();
  const current = manifest.releasedVersions['.'];
  if (!current || target.compare(current) < 0) {
    throw new Error(`Registry version ${target} is behind the release manifest ${current}`);
  }
  // Only release versions proposed in bcr/metadata.json.
  await manifest.createReleases();
  if (target.compare(current) === 0) {
    console.log(`No newer BCR entry than ${current}; no release PR needed`);
    return;
  }
  await (await loadManifest()).createPullRequests();
}

module.exports = {BcrVersion, selectVersion, registerBcrStrategy, run};

if (require.main === module) {
  (async () => {
    const token = process.env.GH_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;
    if (!token || !repository || !/^[^/]+\/[^/]+$/.test(repository)) {
      throw new Error('GH_TOKEN and GITHUB_REPOSITORY=owner/repo are required');
    }
    const [owner, repo] = repository.split('/');
    const github = await GitHub.create({owner, repo, token});
    await run(github, github.repository.defaultBranch);
  })().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
