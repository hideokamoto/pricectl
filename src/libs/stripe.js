const {red} = require('chalk')
const fs = require('fs')
const {CONF_DIR, CONF_FILE} = require('../constants')
const getStripe = () => {
  const confFile = `${CONF_DIR}/${CONF_FILE}`
  let props = {}
  try {
    const file = fs.readFileSync(confFile, 'utf8')
    props = JSON.parse(file)
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.log(red('Please run pricectl init {STRIPE_SK_KEY} at first.'))
    }
    throw new Error(e)
  }
  const stripe = require('stripe')(props.stripe)
  return stripe
}
module.exports = getStripe()
