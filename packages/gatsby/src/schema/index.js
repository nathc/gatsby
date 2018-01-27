/* @flow */
const _ = require(`lodash`)
const { GraphQLSchema, GraphQLObjectType } = require(`graphql`)

const buildNodeTypes = require(`./build-node-types`)
const buildNodeConnections = require(`./build-node-connections`)
const { store } = require(`../redux`)
const invariant = require(`invariant`)
const { initTypeIndex, importForcedTypes } = require(`./types`)

module.exports = async () => {
  initTypeIndex()
  const schemaDefTypeMap = await importForcedTypes()

  const typesGQL = await buildNodeTypes(schemaDefTypeMap)
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
