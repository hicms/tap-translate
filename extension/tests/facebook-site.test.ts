// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.facebook.com/"}
import fixture from './fixtures/sites/facebook.html?raw';
import { socialSiteContract } from './social-site-contract';

socialSiteContract('facebook', fixture, ["Explore our discoveries today.","Useful explanation."]);
