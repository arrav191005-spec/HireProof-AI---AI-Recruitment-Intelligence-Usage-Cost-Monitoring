// Usage: node --import ./tests/helpers/register-alias.mjs --test tests/
import { register } from 'node:module';

register('./alias-loader.mjs', import.meta.url);
