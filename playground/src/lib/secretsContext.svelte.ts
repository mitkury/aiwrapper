import { getContext, hasContext, setContext } from 'svelte';

class SecretsStore {
	values: Record<string, string> = $state({});

	constructor(values: Record<string, string> = {}) {
		Object.assign(this.values, values);
	}

	setSecrets(values: Record<string, string>) {
		Object.assign(this.values, values);
		saveSecrets(this);
	}

	loadSecrets() {
		try {
			const secretsJson = localStorage.getItem('secrets');
			if (secretsJson) {
				const values = JSON.parse(secretsJson) as unknown;
				if (values && typeof values === 'object' && !Array.isArray(values)) {
					for (const [key, value] of Object.entries(values)) {
						if (typeof value === 'string') {
							this.values[key] = value;
						}
					}
				}
			}
		} catch (error) {
			console.warn('Provider settings could not be loaded from local storage', error);
		}
	}
}

export function getSecrets(): SecretsStore {
	if (hasContext('secrets')) {
		return getContext<SecretsStore>('secrets');
	} else {
		const newSecrets = new SecretsStore();
		setContext('secrets', newSecrets);
		return newSecrets;
	}
}

function saveSecrets(secrets: SecretsStore) {
	try {
		localStorage.setItem('secrets', JSON.stringify($state.snapshot(secrets.values)));
	} catch (error) {
		console.warn('Provider settings could not be saved to local storage', error);
	}
}
