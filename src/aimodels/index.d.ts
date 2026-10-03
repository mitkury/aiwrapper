interface TokenBasedPricePerMillionTokens {
    /** Price per million input tokens */
    input: number;
    /** Price per million output tokens */
    output: number;
    /** Price type */
    type: 'token';
}
interface ImagePrice {
    /** Price per image */
    price: number;
    /** Image size */
    size: string;
    /** Price type */
    type: 'image';
    /** Price unit */
    unit: 'per_image';
}

interface ProviderModelsEntry {
    /** ID of the creator whose models are referenced (e.g. 'openai') */
    creator: string;
    /**
     * Either 'all' to include all models from this creator,
     * or an explicit list of model IDs.
     */
    include: 'all' | string[];
    /**
     * Optional list of model IDs from this creator to exclude when include is 'all'.
     */
    exclude?: string[];
    /** Prefix added to canonical model IDs for this provider (for example `openai/`). */
    idPrefix?: string;
    /** Explicit canonical-to-provider model ID overrides. */
    idOverrides?: Record<string, string>;
}
interface ProviderSource {
    id: string;
    name: string;
    apiUrl?: string;
    apiDocsUrl?: string;
    pricing: Record<string, TokenBasedPricePerMillionTokens | ImagePrice>;
    models?: ProviderModelsEntry[];
}
/** Public provider data, optionally enriched with organization metadata. */
interface Provider extends ProviderSource {
    /** Organization website when the provider has a matching organization record. */
    websiteUrl?: string;
    /** Organization country when known. */
    country?: string;
    /** Organization founding year when known. */
    founded?: number;
    /** Whether this is a local provider */
    isLocal?: number;
}

/** Organization data as stored in the keyed source map. */
interface OrganizationSource {
    /** Display name (e.g., "OpenAI", "Meta", "Anthropic") */
    name: string;
    /** Organization's main website URL */
    websiteUrl: string;
    /** Organization's country of origin */
    country: string;
    /** Year founded */
    founded: number;
}
/** Public organization data with its keyed identifier restored. */
interface Organization extends OrganizationSource {
    /** Unique identifier (e.g., "openai", "meta", "anthropic") */
    id: string;
}

/**
 * Defines all possible model capabilities
 */
type Capability = "chat" | "reason" | "txt-in" | "txt-out" | "img-in" | "img-out" | "audio-in" | "audio-out" | "video-in" | "video-out" | "json-out" | "fn-out" | "vec-out";

interface BaseContext {
    /** The type discriminator */
    type: string;
}
interface TokenContext extends BaseContext {
    type: "token";
    /** Maximum input tokens the model can accept */
    total: number | null;
    /** Maximum tokens the model can generate in response */
    maxOutput: number | null;
    /**
     * When set to 1, indicates the model can generate up to maxOutput tokens
     * regardless of input size (as long as input is within total limit).
     * When not set, available output tokens may be reduced based on input size.
     */
    outputIsFixed?: 1;
    /**
     * Extended capabilities beyond the standard model behavior.
     * This is a flexible object that can contain any properties or nested objects
     * related to model-specific extensions (e.g., reasoning, experimental features).
     */
    extended?: Record<string, unknown>;
}
interface CharacterContext extends BaseContext {
    type: "character";
    /** Maximum input characters the model can accept */
    total: number | null;
    /** Maximum characters the model can generate in response */
    maxOutput: number | null;
}
interface ImageContext extends BaseContext {
    type: "image";
    /** Maximum outputs per request */
    maxOutput: number;
    /** Available image sizes (e.g. "1024x1024") */
    sizes: string[];
    /** Available quality settings (e.g. "standard", "hd") */
    qualities: string[];
}
interface AudioInputContext extends BaseContext {
    type: "audio-in";
    /** Maximum duration in seconds, null if unlimited */
    maxDuration?: number | null;
    /** Supported input formats */
    formats?: string[];
    /** Maximum file size in bytes */
    maxSize?: number | null;
}
interface AudioOutputContext extends BaseContext {
    type: "audio-out";
    /** Maximum text length that can be converted to speech */
    maxInput?: number | null;
    /** Supported output formats */
    formats?: string[];
    /** Available voices */
    voices?: string[];
    /** Available quality settings */
    qualities?: string[];
}
interface EmbeddingContext extends BaseContext {
    type: "embedding";
    /** Maximum input size */
    total: number;
    /** Unit of measurement for input */
    unit: "tokens" | "characters";
    /** Size of output embedding vectors */
    dimensions: number;
    /** Type of embeddings produced */
    embeddingType?: "text" | "image" | "audio" | "multimodal";
    /** Normalization of output vectors */
    normalized?: boolean;
}
type ModelContext = TokenContext | CharacterContext | ImageContext | AudioInputContext | AudioOutputContext | EmbeddingContext;

/**
 * Represents the raw model data exactly as it appears in the source files.
 * This is a direct representation of the JSON structure.
 */
interface ModelSource {
    /** Unique identifier */
    id: string;
    /** Display name */
    name?: string;
    /** Model capabilities */
    capabilities?: Capability[];
    /** Context window information */
    context?: ModelContext;
    /** Organization that created this model */
    creatorId?: string;
    /** License type (e.g., "proprietary", "apache-2.0", "llama-2-community") */
    license?: string;
    /** Languages the model knows */
    languages?: string[];
    /** Alternative identifiers for this model */
    aliases?: string[];
    /** ISO release date when publicly documented */
    releasedAt?: string;
    /** Base model ID this model extends */
    extends?: string;
    /** Properties that override the base model */
    overrides?: Partial<Omit<ModelSource, 'id' | 'extends' | 'overrides'>>;
}

/**
 * Enhanced Model class that provides functionality on top of raw model data.
 * Handles inheritance resolution and provides access to related objects.
 */
declare class Model {
    private source;
    constructor(source: ModelSource);
    get id(): string;
    get extends(): string | undefined;
    get overrides(): Partial<ModelSource> | undefined;
    private resolveProperty;
    get name(): string;
    get capabilities(): Capability[];
    get context(): ModelContext | undefined;
    get license(): string | undefined;
    get languages(): string[] | undefined;
    get aliases(): string[] | undefined;
    get releasedAt(): string | undefined;
    private isIncludedBy;
    private providerMapping;
    get providerIds(): string[];
    /**
     * Resolve this catalog model's canonical ID to the ID required by a provider.
     * Returns undefined when the provider does not expose this model.
     */
    idFor(providerId: string): string | undefined;
    get providers(): Provider[];
    get creatorId(): string | undefined;
    get creator(): Organization | undefined;
    /**
     * Check if model has all specified capabilities
     * Uses same API pattern as ModelCollection.can() but returns boolean
     */
    can(...capabilities: Capability[]): boolean;
    canChat(): boolean;
    canReason(): boolean;
    canRead(): boolean;
    canWrite(): boolean;
    canSee(): boolean;
    canGenerateImages(): boolean;
    canHear(): boolean;
    canSpeak(): boolean;
    canOutputJSON(): boolean;
    canCallFunctions(): boolean;
    canGenerateEmbeddings(): boolean;
}

declare class ModelCollection extends Array<Model> {
    static providersData: Record<string, ProviderSource>;
    static orgsData: Record<string, OrganizationSource>;
    static modelSources: Record<string, ModelSource>;
    /** Create a new ModelCollection from an array of models */
    constructor(models?: Model[]);
    /** Set the shared providers data */
    static setProviders(providers: Record<string, Provider>): void;
    /** Set the shared creators data */
    static setOrgs(orgs: Record<string, OrganizationSource>): void;
    /** Filter models by one or more capabilities (all must be present) */
    can(...capabilities: Capability[]): ModelCollection;
    /**
     * Fluent capability filters for better readability
     * Each method filters models by a specific capability
     */
    canChat(): ModelCollection;
    canReason(): ModelCollection;
    canRead(): ModelCollection;
    canWrite(): ModelCollection;
    canSee(): ModelCollection;
    canGenerateImages(): ModelCollection;
    canHear(): ModelCollection;
    canSpeak(): ModelCollection;
    canOutputJSON(): ModelCollection;
    canCallFunctions(): ModelCollection;
    canGenerateEmbeddings(): ModelCollection;
    /** Filter models by one or more languages (all must be supported) */
    know(...languages: string[]): ModelCollection;
    /** Override array filter to return ModelCollection */
    filter(predicate: (value: Model, index: number, array: Model[]) => boolean): ModelCollection;
    /** Override array slice to return ModelCollection */
    slice(start?: number, end?: number): ModelCollection;
    /** Find a model by its ID or alias */
    id(modelId: string): Model | undefined;
    /** Resolve a canonical model ID or alias to the ID required by a provider. */
    resolveModelIdForProvider(modelId: string, providerId: string): string | undefined;
    /** Find a canonical model from an ID returned by a provider. */
    fromProviderId(providerId: string, providerModelId: string): Model | undefined;
    /** Get models available from a specific provider */
    fromProvider(provider: string): ModelCollection;
    /** Get models available from a specific creator */
    fromCreator(creator: string): ModelCollection;
    /** Filter models by minimum context window size */
    withMinContext(tokens: number): ModelCollection;
    /** Get all providers from all models in the collection deduplicated */
    get providers(): Provider[];
    /** Get all orgs from all models in the collection deduplicated */
    get orgs(): Organization[];
    /** Organizations that create models in this collection. */
    get creators(): Organization[];
    /** Providers that expose models in this collection. */
    get activeProviders(): Provider[];
    /** Get a specific provider by ID */
    getProvider(id: string): Provider | undefined;
    /** Get a specific creator by ID */
    getCreator(id: string): Organization | undefined;
    /** Get providers for a specific model */
    getProvidersForModel(modelId: string): Provider[];
    /** Get creator for a specific model */
    getCreatorForModel(modelId: string): Organization | undefined;
}

/**
 * AIModels is a collection of AI models with associated metadata.
 *
 * This class follows the singleton pattern with a private constructor and a static getter.
 * IMPORTANT: Do not instantiate this class directly. Instead, import the pre-configured
 * singleton instance from the package:
 *
 * ```typescript
 * import { models } from 'aimodels';
 * ```
 *
 * The singleton instance contains all the model data and is the recommended way to use this package.
 * If you need to access the class for type references, you can also import it:
 *
 * ```typescript
 * import { AIModels, models } from 'aimodels';
 * ```
 */
declare class AIModels extends ModelCollection {
    private static _instance;
    /**
     * @private
     * Private constructor used only by the static instance getter.
     * Users should import the pre-configured instance from the package.
     */
    private constructor();
    /**
   * Add data to the static data containers
   * @param data Object containing model sources, providers, and organizations to add
   */
    static addStaticData({ models, providers, orgs }: {
        models?: Record<string, ModelSource>;
        providers?: Record<string, ProviderSource>;
        orgs?: Record<string, OrganizationSource>;
    }): void;
    static get instance(): AIModels;
    /**
     * Override to return all providers directly without filtering through models.
     * We want to return all known providers here.
     */
    get providers(): Provider[];
    /** Providers that currently expose at least one catalog model. */
    get activeProviders(): Provider[];
    /**
     * Override to return all creators directly without filtering through models.
     * We want to return all known creators here.
     */
    get orgs(): Organization[];
    /** All known organizations, including providers that are not model creators. */
    get organizations(): Organization[];
    /** Organizations that create at least one model in this catalog. */
    get creators(): Organization[];
}
declare const models: AIModels;

export { AIModels, type AudioInputContext, type AudioOutputContext, type BaseContext, type Capability, type CharacterContext, type EmbeddingContext, type ImageContext, Model, ModelCollection, type ModelContext, type ModelSource, type Organization, type OrganizationSource, type Provider, type ProviderModelsEntry, type ProviderSource, type TokenContext, models };
