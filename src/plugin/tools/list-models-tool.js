// src/plugin/tools/list-models-tool.js
// foundry_models_list — enumerates models via the SDK client.

/**
 * Determine the set of connected provider names from the SDK client.
 * Returns null when the check fails (no filtering applied).
 */
async function getConnectedNames(client) {
  try {
    const providerList = await client.provider.list();
    if (providerList && Array.isArray(providerList.connected)) {
      return new Set(providerList.connected);
    }
  } catch {
    // If provider.list() fails, do not filter by connection status
  }
  return null;
}

/**
 * Add model entries for a single provider to the models array.
 */
function addModelKeys(provider, models) {
  const modelKeys = provider.models === null || provider.models === undefined
    ? []
    : Object.keys(provider.models);
  for (const key of modelKeys) {
    models.push({ id: `${provider.name}/${key}`, provider: provider.name, model: key });
  }
}

/**
 * Build a models array from a list of providers, filtering to connected ones.
 */
function buildModels(providers, connectedNames) {
  const models = [];
  const list = Array.isArray(providers) ? providers : [];
  for (const provider of list) {
    if (connectedNames !== null && !connectedNames.has(provider.name)) continue;
    addModelKeys(provider, models);
  }
  return models;
}

export function createListModelsTool({ tool, client }) {
  return {
    foundry_models_list: tool({
      description: 'List available models from configured and connected providers via the SDK.',
      args: {},
      async execute(_args, _context) {
        if (!client) {
          return JSON.stringify({
            error: 'foundry_models_list: client not available. Ensure the plugin is loaded with SDK access.',
          });
        }

        let providers;
        try {
          const response = await client.config.providers();
          providers = response.providers;
        } catch (err) {
          return JSON.stringify({
            error: `foundry_models_list: failed to enumerate providers: ${err.message ?? String(err)}`,
          });
        }

        const connectedNames = await getConnectedNames(client);
        const models = buildModels(providers, connectedNames);

        return JSON.stringify({ models });
      },
    }),
  };
}
