import { Command, Help } from '@oclif/core';

/** Where the pricectl documentation is published. */
export const DOCS_URL = 'https://github.com/hideokamoto/pricectl#readme';

/** The help of pricectl: oclif's, followed by where to read the documentation. */
export default class PricectlHelp extends Help {
  async showRootHelp(): Promise<void> {
    await super.showRootHelp();
    this.log(this.documentation());
  }

  async showCommandHelp(command: Command.Loadable): Promise<void> {
    await super.showCommandHelp(command);
    this.log(this.documentation());
  }

  private documentation(): string {
    return this.section('DOCUMENTATION', DOCS_URL);
  }
}
