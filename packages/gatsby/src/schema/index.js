/* @flow */
const _ = require(`lodash`)
const { GraphQLSchema, GraphQLObjectType } = require(`graphql`)

const buildNodeTypes = require(`./build-node-types`)
const buildNodeConnections = require(`./build-node-connections`)
const { store } = require(`../redux`)
const invariant = require(`invariant`)
const { getSchemaDefTypeMap } = require(`./types/definitions`)
const { initTypeRegistry } = require(`./types/graphql-type-registry`)

module.exports = async () => {
  // Schema is created 2 times and schema can't contain 2 different types
  // with same name. To prevent that we clear registry before building schema
  // so we don't pull type from first schema creation before we register same
  // type second time.
  initTypeRegistry()

  const typesGQL = await buildNodeTypes(getSchemaDefTypeMap())
  const connections = buildNodeConnections(_.values(typesGQL))

  // Pull off just the graphql node from each type object.
  const nodes = _.mapValues(typesGQL, `node`)

  invariant(!_.isEmpty(nodes), `There are no available GQL nodes`)
  invariant(!_.isEmpty(connections), `There are no available GQL connections`)

  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: `RootQueryType`,
      fields: { ...connections, ...nodes },
    }),
  })

  store.dispatch({
    type: `SET_SCHEMA`,
    payload: schema,
  })
}
