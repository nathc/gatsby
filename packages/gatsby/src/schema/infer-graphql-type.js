// @flow
const {
  GraphQLObjectType,
  GraphQLBoolean,
  GraphQLString,
  GraphQLFloat,
  GraphQLInt,
  GraphQLList,
  GraphQLUnionType,
  GraphQLScalarType,
} = require(`graphql`)
const _ = require(`lodash`)
const invariant = require(`invariant`)
const { oneLine } = require(`common-tags`)

const { store, getNode, getNodes } = require(`../redux`)
const { createPageDependency } = require(`../redux/actions/add-page-dependency`)
const createTypeName = require(`./create-type-name`)
const createKey = require(`./create-key`)
const {
  extractFieldExamples,
  isEmptyObjectOrArray,
} = require(`./data-tree-utils`)
const DateType = require(`./types/type-date`)
const FileType = require(`./types/type-file`)
const {
  registerGraphQLType,
  getGraphQLType,
  wrapFieldInList,
  isScalarTypeDef,
} = require(`./types`)

import type { GraphQLOutputType } from "graphql"
import type {
  GraphQLFieldConfig,
  GraphQLFieldConfigMap,
} from "graphql/type/definition"

export type ProcessedNodeType = {
  name: string,
  nodes: any[],
  node: GraphQLFieldConfig<*, *>,
  fieldsFromPlugins: any,
  nodeObjectType: GraphQLOutputType,
}

function inferGraphQLType({
  exampleValue,
  selector,
  nodes,
  types,
  schemaDefTypeMap,
  forcedFieldType = null,
  ...otherArgs
}): ?GraphQLFieldConfig<*, *> {
  if (exampleValue == null || isEmptyObjectOrArray(exampleValue)) return null
  let fieldName = selector.split(`.`).pop()

  // Check this before checking for array as FileType has
  // builtin support for inferring array of files and inferred
  // array type will have faster resolver than resolving array
  // of files separately.
  if (FileType.shouldInfer(nodes, selector, exampleValue)) {
    return _.isArray(exampleValue) ? FileType.getListType() : FileType.getType()
  }

  if (Array.isArray(exampleValue)) {
    exampleValue = exampleValue[0]

    if (exampleValue == null) return null

    let inferredType = inferGraphQLType({
      ...otherArgs,
      exampleValue,
      selector,
      nodes,
      types,
    })
    invariant(
      inferredType,
      `Could not infer graphQL type for value: ${exampleValue}`
    )

    return wrapFieldInList(inferredType)
  }

  if (DateType.shouldInfer(exampleValue)) {
    return DateType.getType()
  }

  switch (typeof exampleValue) {
    case `boolean`:
      return { type: GraphQLBoolean }
    case `string`:
      return { type: GraphQLString }
    case `object`: {
      const typeName = forcedFieldType
        ? forcedFieldType.type
        : createTypeName(fieldName)

      return registerGraphQLType(typeName, {
        type: new GraphQLObjectType({
          name: typeName,
          fields: inferObjectStructureFromNodes({
            ...otherArgs,
            exampleValue,
            typeName,
            selector,
            nodes,
            types,
            schemaDefTypeMap,
          }),
        }),
      })
    }
    case `number`:
      return _.isInteger(exampleValue)
        ? { type: GraphQLInt }
        : { type: GraphQLFloat }
    default:
      return null
  }
}

function inferFromMapping(
  value,
  mapping,
  fieldSelector,
  types
): ?GraphQLFieldConfig<*, *> {
  const matchedTypes = types.filter(
    type => type.name === mapping[fieldSelector]
  )
  if (_.isEmpty(matchedTypes)) {
    console.log(`Couldn't find a matching node type for "${fieldSelector}"`)
    return null
  }

  const findNode = (fieldValue, path) => {
    const linkedType = mapping[fieldSelector]
    const linkedNode = _.find(
      getNodes(),
      n => n.internal.type === linkedType && n.id === fieldValue
    )
    if (linkedNode) {
      createPageDependency({ path, nodeId: linkedNode.id })
      return linkedNode
    }
    return null
  }

  if (_.isArray(value)) {
    return {
      type: new GraphQLList(matchedTypes[0].nodeObjectType),
      resolve: (node, a, b, { fieldName }) => {
        const fieldValue = node[fieldName]

        if (fieldValue) {
          return fieldValue.map(value => findNode(value, b.path))
        } else {
          return null
        }
      },
    }
  }

  return {
    type: matchedTypes[0].nodeObjectType,
    resolve: (node, a, b, { fieldName }) => {
      const fieldValue = node[fieldName]

      if (fieldValue) {
        return findNode(fieldValue, b.path)
      } else {
        return null
      }
    },
  }
}

function findLinkedNode(value, linkedField, path) {
  let linkedNode
  // If the field doesn't link to the id, use that for searching.
  if (linkedField) {
    linkedNode = getNodes().find(n => n[linkedField] === value)
    // Else the field is linking to the node's id, the default.
  } else {
    linkedNode = getNode(value)
  }

  if (linkedNode) {
    if (path) createPageDependency({ path, nodeId: linkedNode.id })
    return linkedNode
  }
  return null
}

function inferFromFieldName(value, selector, types): GraphQLFieldConfig<*, *> {
  let isArray = false
  if (_.isArray(value)) {
    isArray = true
    // Reduce values to nodes with unique types.
    value = _.uniqBy(value, v => getNode(v).internal.type)
  }

  const key = selector.split(`.`).pop()
  const [, , linkedField] = key.split(`___`)

  const validateLinkedNode = linkedNode => {
    invariant(
      linkedNode,
      oneLine`
        Encountered an error trying to infer a GraphQL type for: "${selector}".
        There is no corresponding node with the ${linkedField || `id`}
        field matching: "${value}"
      `
    )
  }
  const validateField = (linkedNode, field) => {
    invariant(
      field,
      oneLine`
        Encountered an error trying to infer a GraphQL type for: "${selector}".
        There is no corresponding GraphQL type "${
          linkedNode.internal.type
        }" available
        to link to this node.
      `
    )
  }

  const findNodeType = node =>
    types.find(type => type.name === node.internal.type)

  if (isArray) {
    const linkedNodes = value.map(v => findLinkedNode(v))
    linkedNodes.forEach(node => validateLinkedNode(node))
    const fields = linkedNodes.map(node => findNodeType(node))
    fields.forEach((field, i) => validateField(linkedNodes[i], field))

    let type
    // If there's more than one type, we'll create a union type.
    if (fields.length > 1) {
      type = new GraphQLUnionType({
        name: `Union_${key}_${fields.map(f => f.name).join(`__`)}`,
        description: `Union interface for the field "${key}" for types [${fields
          .map(f => f.name)
          .join(`, `)}]`,
        types: fields.map(f => f.nodeObjectType),
        resolveType: data =>
          fields.find(f => f.name == data.internal.type).nodeObjectType,
      })
    } else {
      type = fields[0].nodeObjectType
    }

    return {
      type: new GraphQLList(type),
      resolve: (node, a, b = {}) => {
        let fieldValue = node[key]
        if (fieldValue) {
          return fieldValue.map(value =>
            findLinkedNode(value, linkedField, b.path)
          )
        } else {
          return null
        }
      },
    }
  }

  const linkedNode = findLinkedNode(value, linkedField)
  validateLinkedNode(linkedNode)
  const field = findNodeType(linkedNode)
  validateField(linkedNode, field)
  return {
    type: field.nodeObjectType,
    resolve: (node, a, b = {}) => {
      let fieldValue = node[key]
      if (fieldValue) {
        const result = findLinkedNode(fieldValue, linkedField, b.path)
        return result
      } else {
        return null
      }
    },
  }
}

type inferTypeOptions = {
  nodes: Object[],
  types: ProcessedNodeType[],
  selector?: string,
  exampleValue?: Object,
  typeName?: string,
  schemaDefTypeMap?: Object,
}

const EXCLUDE_KEYS = {
  id: 1,
  parent: 1,
  children: 1,
}

// Call this for the top level node + recursively for each sub-object.
// E.g. This gets called for Markdown and then for its frontmatter subobject.
export function inferObjectStructureFromNodes({
  nodes,
  types,
  selector,
  typeName,
  schemaDefTypeMap = {},
  exampleValue = extractFieldExamples(nodes),
}: inferTypeOptions): GraphQLFieldConfigMap<*, *> {
  const config = store.getState().config
  const isRoot = !selector
  const mapping = config && config.mapping

  // Ensure nodes have internal key with object.
  nodes = nodes.map(n => (n.internal ? n : { ...n, internal: {} }))

  // Check if we have defined field types of processed nodes type
  const forcedFieldTypes =
    typeName in schemaDefTypeMap ? schemaDefTypeMap[typeName] : {}

  const inferredFields = {}
  _.each(exampleValue, (value, key) => {
    // Remove fields common to the top-level of all nodes.  We add these
    // elsewhere so don't need to infer their type.
    if (isRoot && EXCLUDE_KEYS[key]) return

    // Several checks to see if a field is pointing to custom type
    // before we try automatic inference.
    const nextSelector = selector ? `${selector}.${key}` : key
    const fieldSelector = `${nodes[0].internal.type}.${nextSelector}`

    const forcedFieldType =
      key in forcedFieldTypes ? forcedFieldTypes[key] : null

    let fieldName = key
    let inferredField

    if (forcedFieldType) {
      // special case for objects - we want to append our defined fields to
      // automaticly infered fields
      if (_.isPlainObject(value) && !isScalarTypeDef(forcedFieldType)) {
        inferredField = inferGraphQLType({
          nodes,
          types,
          schemaDefTypeMap,
          exampleValue: value,
          selector: nextSelector,
          forcedFieldType,
        })
      } else {
        inferredField = getGraphQLType(forcedFieldType)
      }

      // First check for manual field => type mappings in the site's
      // gatsby-config.js
    } else if (mapping && _.includes(Object.keys(mapping), fieldSelector)) {
      inferredField = inferFromMapping(value, mapping, fieldSelector, types)

      // Second if the field has a suffix of ___node. We use then the value
      // (a node id) to find the node and use that node's type as the field
    } else if (_.includes(key, `___NODE`)) {
      ;[fieldName] = key.split(`___`)
      inferredField = inferFromFieldName(value, nextSelector, types)
    }

    // Finally our automatic inference of field value type.
    if (!inferredField) {
      inferredField = inferGraphQLType({
        nodes,
        types,
        schemaDefTypeMap,
        exampleValue: value,
        selector: nextSelector,
      })
    }

    if (!inferredField) return

    // Replace unsupported values
    inferredFields[createKey(fieldName)] = inferredField
  })

  // Add fields that are not inferred but are in schema definition
  if (forcedFieldTypes) {
    _.each(forcedFieldTypes, (forcedFieldType, fieldName) => {
      if (fieldName in inferredFields) {
        // If we inferred type, then we already used type from schema definition
        // and it's already correct type so don't process it.
        return
      }

      inferredFields[createKey(fieldName)] = getGraphQLType(forcedFieldType)
    })
  }

  return inferredFields
}
