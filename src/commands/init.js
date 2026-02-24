const {Command, flags} = require('@oclif/command')
const {green, red} = require('chalk')
const fs = require('fs')
const {CONF_DIR, CONF_FILE} = require('../constants')

class InitCommand extends Command {
  createGitignore() {
    let content = ''
    const path = './.gitignore'
    try {
      content = fs.readFileSync(path, 'utf8')
      if (/.pricectl/g.test(content)) return
    } catch (e) {
      if (e.code !== 'ENOENT') {
        this.log(e)
        this.exit(1)
        return
      }
    }
    content += '\n.pricectl/'
    try {
      fs.writeFileSync(path, content)
    } catch (e) {
      this.log(e)
      this.exit(1)
    }
  }

  validateStripeKey(key) {
    if (key.startsWith('pk_')) {
      this.log(red('The key is not secret key. Please put secret key'))
      this.exit(1)
      return false
    }
    if (key.startsWith('sk_')) return true
    this.log(red('Invlid key provided. Please put secret key'))
    this.exit(1)
    return false
  }

  configure() {
    try {
      fs.mkdirSync(CONF_DIR)
    } catch (e) {
      if (e.code !== 'EEXIST') {
        this.log(e)
        this.exit(1)
        return
      }
    }
    let props = {}

    const confFile = `${CONF_DIR}/${CONF_FILE}`
    try {
      const file = fs.readFileSync(confFile, 'utf8')
      props = JSON.parse(file)
    } catch (e) {
      if (e.code !== 'ENOENT') {
        this.log(e)
        this.exit(1)
        return
      }
    }
    const {args} = this.parse(InitCommand)
    const {stripe} = args
    if (!this.validateStripeKey(stripe)) return
    const output = {
      ...props,
      stripe,
    }
    try {
      fs.writeFileSync(confFile, JSON.stringify(output))
    } catch (e) {
      this.log(e)
      this.exit(1)
    }
  }

  async run() {
    this.configure()
    this.createGitignore()
    this.log(green('Configured !'))
  }
}

InitCommand.description = `Initialize pricectl
...
To put Stripe secret key into .pricectl/config
The file will be ignored from git.
`

InitCommand.flags = {
  help: flags.help({char: 'h'}),
}
InitCommand.args = [
  {
    name: 'stripe',
    required: true,
    description: 'Stripe secret key',
  },
]
module.exports = InitCommand
