import { getContext, hasContext, setContext } from "svelte";

class SecretsStore {
  values: Record<string, string> = $state({});

  constructor(values: Record<string, string> = {}) {
    Object.assign(this.values, values);
  }

  setSecrets(values: Record<string, string>) {
    Object.assign(this.values, values);
    saveSecrets(this);
  }
  
  setSecret(key: string, value: string) {
    this.values[key] = value;
    saveSecrets(this);
  }

  loadSecrets() {
    const secretsJson = localStorage.getItem("secrets");
    if (secretsJson) {
      const values = JSON.parse(secretsJson) as Record<string, string>;
      Object.assign(this.values, values);
    }
  }
}

export function getSecrets(): SecretsStore {
  if (hasContext("secrets")) {
    return getContext<SecretsStore>("secrets");
  } else {
    const newSecrets = new SecretsStore();
    setContext("secrets", newSecrets);
    return newSecrets;
  }
}

function saveSecrets(secrets: SecretsStore) {
  localStorage.setItem("secrets", JSON.stringify($state.snapshot(secrets.values)));
}



