// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/"}
import fixture from './fixtures/sites/youtube.html?raw';
import { socialSiteContract } from './social-site-contract';

socialSiteContract('youtube', fixture, ["Exploring our universe.","Explore our discoveries today.","Useful explanation.","A journey through space."]);
