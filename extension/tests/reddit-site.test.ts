// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.reddit.com/"}
import fixture from './fixtures/sites/reddit.html?raw';
import { socialSiteContract } from './social-site-contract';

socialSiteContract('reddit', fixture, ["Exploring our universe.","Explore our discoveries today.","Useful explanation."]);
