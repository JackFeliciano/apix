// Runs the showroom demo suite on its own.
import { run } from '../demo/showroom.test.js';

const result = await run();
if (result.fail > 0) process.exitCode = 1;
