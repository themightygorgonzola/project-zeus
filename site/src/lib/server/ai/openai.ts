export interface ChatMessageInput {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface BaseChatOptions {
	apiKey: string;
	model: string;
	messages: ChatMessageInput[];
}

export async function completeChat({ apiKey, model, messages }: BaseChatOptions): Promise<string> {
	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({ model, messages })
	});

	if (!response.ok) {
		throw new Error(`OpenAI API error ${response.status}: ${await response.text()}`);
	}

	const completion = (await response.json()) as {
		choices: Array<{ message: { content: string } }>;
	};

	return completion.choices[0]?.message.content ?? '';
}

export async function streamChat(
	{ apiKey, model, messages }: BaseChatOptions,
	onChunk: (chunk: string) => Promise<void> | void
): Promise<string> {
	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({ model, messages, stream: true })
	});

	if (!response.ok) {
		throw new Error(`OpenAI API error ${response.status}: ${await response.text()}`);
	}

	if (!response.body) {
		throw new Error('OpenAI response body was empty');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let fullText = '';

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';

		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line.startsWith('data:')) continue;
			const data = line.slice(5).trim();
			if (!data || data === '[DONE]') continue;

			try {
				const json = JSON.parse(data) as {
					choices?: Array<{ delta?: { content?: string } }>;
				};
				const chunk = json.choices?.[0]?.delta?.content ?? '';
				if (!chunk) continue;
				fullText += chunk;
				await onChunk(chunk);
			} catch {
				// Ignore malformed partial chunks.
			}
		}
	}

	return fullText;
}
