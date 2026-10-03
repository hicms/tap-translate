// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.threads.com/"}
import fixture from './fixtures/sites/threads.html?raw';
import { socialSiteContract } from './social-site-contract';

socialSiteContract('threads', fixture, ["Explore our discoveries today.","Useful explanation."]);
