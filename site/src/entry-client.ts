// The only JavaScript shipped to the browser: no framework, no hydration.
import './styles/main.css';
import { initContactForm } from './client/contact-form';
import { initMenu } from './client/menu';

const start = () => {
  initMenu();
  initContactForm();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
