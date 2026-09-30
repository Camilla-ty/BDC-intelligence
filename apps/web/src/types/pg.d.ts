declare module "pg" {
  export interface QueryResult {
    rows: unknown[];
    command: string | null;
  }

  export class Client {
    constructor(config: {
      connectionString: string;
      ssl?: false | { rejectUnauthorized: boolean };
      connectionTimeoutMillis?: number;
    });
    connect(): Promise<void>;
    query(config: {
      text: string;
      queryMode?: "simple";
      rowMode?: "array";
    }): Promise<QueryResult | QueryResult[]>;
    end(): Promise<void>;
  }
}
