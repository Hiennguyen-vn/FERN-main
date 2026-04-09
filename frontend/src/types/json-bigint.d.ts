declare module 'json-bigint' {
  interface JsonBigOptions {
    storeAsString?: boolean;
    useNativeBigInt?: boolean;
  }

  interface JsonBigInstance {
    parse(text: string): unknown;
    stringify(value: unknown): string;
  }

  export default function JSONbig(options?: JsonBigOptions): JsonBigInstance;
}
