const { createBuilder } = require('@angular-devkit/architect')
const { buildApplication } = require('@angular/build')
const { withEnv } = require('./env')

/** `ng build`: @angular/build:application, with the NG_APP_ variables from .env. */
module.exports = createBuilder(async function* (options, context) {
  yield* buildApplication(await withEnv(options, context), context)
})
