const assert = require('node:assert/strict');
const {test} = require('node:test');
const {BcrVersion, selectVersion, registerBcrStrategy, run} = require('../tools/bcr_release.cjs');
const {buildStrategy} = require('release-please/build/src/factory.js');
const {TagName} = require('release-please/build/src/util/tag-name.js');
const {ReleasePleaseManifest} = require('release-please/build/src/updaters/release-please-manifest.js');
const {parseConventionalCommits} = require('release-please/build/src/commit.js');

test('BCR versions retain their suffix and sort revisions numerically', () => {
  const versions = ['11.8.1.bcr.10', '0.2.1', '11.8.2', '11.8.1.bcr.2', '11.8.1'];
  const sorted = versions.map(value => BcrVersion.parse(value)).sort((a, b) => a.compare(b));
  assert.deepEqual(sorted.map(version => version.toString()), [
    '0.2.1', '11.8.1', '11.8.1.bcr.2', '11.8.1.bcr.10', '11.8.2',
  ]);
  for (const version of versions) {
    assert.equal(TagName.parse(`v${version}`).toString(), `v${version}`);
  }
  for (const invalid of ['11.8.1.bcr.0', '11.8.1.bcr.01', '11.8.1-bcr.1', '11.8.1+build', 'v11.8.1', '11.8.1.bcr.1junk']) {
    assert.throws(() => BcrVersion.parse(invalid), /Invalid BCR/);
  }
});

test('wrapper opens the first BCR release PR and stops after that version is merged', async () => {
  const metadata = {versions: ['11.8.1']};
  let current = '0.2.1';
  let created;
  let merged;
  let published;
  const github = {
    repository: {owner: 'perplexityai', repo: 'rocksdb', defaultBranch: 'main'},
    async getFileContentsOnBranch() { return {parsedContent: JSON.stringify(metadata)}; },
    async getFileJson(path) {
      if (path === '.release-please-manifest.json') return {'.': current};
      return require('../release-please-config.json');
    },
    async *pullRequestIterator(branch, state) {
      if (state === 'MERGED' && merged) yield merged;
    },
    async *releaseIterator() { yield {tagName: `v${current}`, sha: 'previous'}; },
    async *mergeCommitIterator() {
      yield {sha: 'change', message: 'fix: restore release automation', files: ['tools/bcr_release.cjs']};
      yield {sha: 'previous', message: 'chore(main): release 0.2.1', files: ['CHANGELOG.md']};
    },
    async generateReleaseNotes(tag, branch, previousTag) {
      assert.deepEqual([tag, branch, previousTag], ['v11.8.1', 'main', 'v0.2.1']);
      return '## Changes\n* Restore release automation';
    },
    async createPullRequest(pr, branch, message, updates) {
      created = {pr, branch, message, updates};
      return {...pr, number: 123};
    },
    async createRelease(release, options) {
      published = {release, options};
      return {tagName: release.tag.toString(), url: 'https://github.com/perplexityai/rocksdb/releases/tag/v11.8.1'};
    },
    async commentOnIssue() {},
    async removeIssueLabels(labels, number) {
      assert.deepEqual([labels, number], [['autorelease: pending'], 123]);
      merged = undefined;
    },
    async addIssueLabels(labels, number) {
      assert.deepEqual([labels, number], [['autorelease: tagged'], 123]);
    },
  };
  await run(github, 'main');
  assert.equal(created.pr.title, 'chore(main): release 11.8.1');
  assert.deepEqual(created.pr.labels, ['autorelease: pending']);
  const manifestUpdate = created.updates.find(update => update.path === '.release-please-manifest.json');
  assert.deepEqual(JSON.parse(manifestUpdate.updater.updateContent('{".":"0.2.1"}')), {'.': '11.8.1'});
  merged = {...created.pr, number: 123, sha: 'merged'};
  current = '11.8.1';
  created = undefined;
  await run(github, 'main');
  assert.equal(created, undefined);
  assert.equal(published.release.tag.toString(), 'v11.8.1');
  assert.equal(published.release.sha, 'merged');
  assert.ok(!published.options.prerelease);
  published = undefined;
  await run(github, 'main');
  assert.equal(published, undefined);
  current = '11.8.1.bcr.1';
  await assert.rejects(() => run(github, 'main'), /behind the release manifest/);
});

test('registry selection uses the newest entry and rejects a yanked latest version', () => {
  const metadata = {versions: ['11.8.1.bcr.10', '11.8.1', '11.8.1.bcr.2']};
  assert.equal(selectVersion(metadata).toString(), '11.8.1.bcr.10');
  assert.throws(() => selectVersion({...metadata, yanked_versions: {'11.8.1.bcr.10': 'broken'}}), /must not be yanked/);
  assert.throws(() => selectVersion({versions: []}), /must exist/);
});

test('real release-please generates a BCR PR, file updates, and a stable release tag', async () => {
  const target = BcrVersion.parse('11.8.1.bcr.10');
  registerBcrStrategy(target);
  const strategy = await buildStrategy({
    github: {
      repository: {owner: 'perplexityai', repo: 'rocksdb'},
      async generateReleaseNotes(tag, branch, previousTag) {
        assert.deepEqual([tag, branch, previousTag], ['v11.8.1.bcr.10', 'main', 'v11.8.1.bcr.2']);
        return '## Changes\n* Change overlay';
      },
    },
    targetBranch: 'main', path: '.', packageName: 'rocksdb',
    releaseType: 'bcr-bazel', versioning: 'bcr', includeComponentInTag: false, changelogType: 'github',
  });
  const latestRelease = {tag: TagName.parse('v11.8.1.bcr.2'), sha: 'previous'};
  const pr = await strategy.buildReleasePullRequest(parseConventionalCommits([
    {sha: 'change', message: 'feat!: change overlay\n\nRelease-As: 99.0.0', files: ['MODULE.bazel']},
  ]), latestRelease);
  assert.ok(pr);
  assert.equal(pr.title.toString(), 'chore(main): release 11.8.1.bcr.10');
  const moduleUpdate = pr.updates.find(update => update.path === 'MODULE.bazel');
  assert.equal(moduleUpdate.updater.updateContent('module(name = "rocksdb_development", version = "11.8.1.bcr.2")\n'),
    'module(name = "rocksdb_development", version = "11.8.1.bcr.10")\n');
  const changelog = pr.updates.find(update => update.path === 'CHANGELOG.md').updater.updateContent('# Changelog\n');
  assert.match(changelog, /11\.8\.1\.bcr\.10/);
  const updater = new ReleasePleaseManifest({versionsMap: new Map([['.', target]])});
  assert.deepEqual(JSON.parse(updater.updateContent('{".":"11.8.1.bcr.2"}')), {'.': '11.8.1.bcr.10'});
  const release = await strategy.buildRelease({
    title: pr.title.toString(), body: pr.body.toString(), headBranchName: pr.headRefName, sha: 'merged',
  });
  assert.ok(release);
  assert.equal(release.tag.toString(), 'v11.8.1.bcr.10');
  assert.equal(release.tag.version.preRelease, undefined);
  await assert.rejects(() => strategy.buildReleases({
    title: 'chore(main): release 0.3.0', body: pr.body.toString(), headBranchName: pr.headRefName, sha: 'merged',
  }), /unregistered or yanked/);
  await assert.rejects(() => strategy.buildReleasePullRequest(parseConventionalCommits([
    {sha: 'another', message: 'fix: another overlay edit', files: ['MODULE.bazel']},
  ]), {tag: release.tag, sha: 'merged'}), /must be newer/);
});
