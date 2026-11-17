import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cascadeConfig, startCascade } from '$lib/server/native-cascade';
export const GET: RequestHandler = () => json(cascadeConfig());
export const POST: RequestHandler = async ({ request }) => {
	try {
		return startCascade(await request.json(), request.signal);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not start session' },
			{ status: 400 }
		);
	}
};
