export interface D1Meta {
	changes: number;
	last_row_id: number;
	duration?: number;
	rows_read?: number;
	rows_written?: number;
}

export interface D1Result<T = Record<string, unknown>> {
	results: T[];
	success: boolean;
	meta: D1Meta;
}

export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
	run(): Promise<D1Result>;
}

export interface D1Database {
	prepare(query: string): D1PreparedStatement;
	batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface Env {
	DB: D1Database;
	ASSETS: { fetch(request: Request): Promise<Response> };
	/** The original single-owner token; it keeps working as the "legacy" account. */
	SYNC_TOKEN?: string;
	/** Display name for that legacy account. */
	OWNER_NAME?: string;
	/** When set, creating an account needs this code. Unset allows open signup. */
	SIGNUP_CODE?: string;
	ALLOWED_ORIGIN?: string;
}
