class IpaParserStub {
  constructor() {
    throw new Error('IPA parsing is not supported in browser');
  }
  parse(): Promise<never> {
    throw new Error('IPA parsing is not supported in browser');
  }
}
export default IpaParserStub;
