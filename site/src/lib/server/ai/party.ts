export async function notifyRoom(
	host: string,
	roomId: string,
	body: Record<string, unknown>
): Promise<void> {
	const url = `https://${host}/parties/main/${roomId}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});

	if (!res.ok) {
		console.warn(`PartyKit notify failed (${res.status}): ${await res.text()}`);
	}
}
