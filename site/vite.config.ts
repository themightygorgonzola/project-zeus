import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	// Populate process.env from .env files so server-side code that uses
	// process.env (including Trigger.dev task code) can read all variables.
	const env = loadEnv(mode, process.cwd(), '');
	Object.assign(process.env, env);

	return {
		plugins: [sveltekit()],
		server: {
			port: 5173
		}
	};
});
