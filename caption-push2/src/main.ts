import { initDisplay } from './display.js';
import { initOperator } from './operator.js';

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');
const rawId = parseInt(params.get('id') ?? '1', 10);
const displayId = isNaN(rawId) || rawId < 1 ? 1 : rawId;

if (mode === 'display') {
  initDisplay(displayId);
} else {
  initOperator();
}
