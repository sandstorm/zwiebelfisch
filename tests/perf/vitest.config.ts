// Vitest for the measurements (`mise run perf:typing`): the unit tests' setup (vite.config.ts), only tests/perf/.
// See typing.perf.ts.
import { defineConfig } from 'vitest/config';
import unit from '../../vite.config.ts';

export default defineConfig({ ...unit, test: { ...unit.test, include: ['tests/perf/**/*.perf.ts'] } });
