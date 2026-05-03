declare module 'json-bigint' {
  interface Options { storeAsString?: boolean; strict?: boolean; useNativeBigInt?: boolean }
  interface JSONBigInstance {
    parse(text: string): any
    stringify(value: any): string
  }
  function JSONBig(options?: Options): JSONBigInstance
  export = JSONBig
}
