import { mountPage } from '../../ui/mount';
import { OptionsApp } from './app';
import './style.css';

void mountPage((settings) => <OptionsApp settings={settings} />);
