declare module "pg" {
  export interface QueryResult {
    rows: unknown[];
    command: string | null;
  }

  export type QueryConfig = {
    text: string;
    queryMode?: "simple";
    rowMode?: "array";
  };

  export class Client {
    constructor(config: {
      connectionString: string;
      ssl?: false | { rejectUnauthorized: boolean };
      connectionTimeoutMillis?: number;
    });
    connect(): Promise<void>;
    query(config: QueryConfig): Promise<QueryResult | QueryResult[]>;
    query(text: string): Promise<QueryResult | QueryResult[]>;
    end(): Promise<void>;
  }

  export interface PoolClient {
    query(config: QueryConfig): Promise<QueryResult | QueryResult[]>;
    query(text: string): Promise<QueryResult | QueryResult[]>;
    /** Pass true (or an Error) to destroy the client instead of returning it to the pool. */
    release(err?: Error | boolean): void;
  }

  export class Pool {
    constructor(config: {
      connectionString: string;
      ssl?: false | { rejectUnauthorized: boolean };
      max?: number;
      idleTimeoutMillis?: number;
      connectionTimeoutMillis?: number;
      allowExitOnIdle?: boolean;
    });
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    readonly totalCount: number;
    readonly idleCount: number;
    readonly waitingCount: number;
  }
}
