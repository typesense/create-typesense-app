const { createBuilder } = require('@angular-devkit/architect')
const { executeDevServerBuilder } = require('@angular/build')
const { withEnv } = require('./env')

/**
 * `ng serve`: @angular/build:dev-server, with the NG_APP_ variables from .env.
 * Read once at start, so restart it after editing .env.
 */
module.exports = createBuilder(async function* (options, context) {
  // The dev server fetches the build target's options itself; hand it ours.
  const getTargetOptions = context.getTargetOptions.bind(context)
  context.getTargetOptions = async (target) => withEnv(await getTargetOptions(target), context)
  const validated = await context.validateOptions(options, '@angular/build:dev-server')
  yield* executeDevServerBuilder(validated, context)
})
