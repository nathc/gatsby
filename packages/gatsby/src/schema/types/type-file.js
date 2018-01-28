const { GraphQLList } = require(`graphql`)
const _ = require(`lodash`)
const mime = require(`mime`)
const isRelative = require(`is-relative`)
const isRelativeUrl = require(`is-relative-url`)
const normalize = require(`normalize-path`)
const systemPath = require(`path`)

const { getNode, getNodes, getRootNodeId } = require(`../../redux`)
const {
  createPageDependency,
} = require(`../../redux/actions/add-page-dependency`)
const { joinPath } = require(`../../utils/path`)
const { registerGraphQLType } = require(`./graphql-type-registry`)

let type, listType

export function setFileNodeRootType(fileNodeRootType) {
  if (fileNodeRootType) {
    type = createType(fileNodeRootType, false)
    listType = createType(fileNodeRootType, true)

    registerGraphQLType(`File`, type)
    registerGraphQLType(`[File]`, listType)
  } else {
    type = null
    listType = null
  }
}

function findRootNode(node) {
  // Find the root node.
  let rootNode = node
  let whileCount = 0
  let rootNodeId
  while (
    (rootNodeId = getRootNodeId(rootNode) || rootNode.parent) &&
    (getNode(rootNode.parent) !== undefined || getNode(rootNodeId)) &&
    whileCount < 101
  ) {
    if (rootNodeId) {
      rootNode = getNode(rootNodeId)
    } else {
      rootNode = getNode(rootNode.parent)
    }
    whileCount += 1
    if (whileCount > 100) {
      console.log(
        `It looks like you have a node that's set its parent as itself`,
        rootNode
      )
    }
  }

  return rootNode
}

function pointsToFile(nodes, key, value) {
  const looksLikeFile =
    _.isString(value) &&
    mime.lookup(value) !== `application/octet-stream` &&
    // domains ending with .com
    mime.lookup(value) !== `application/x-msdownload` &&
    isRelative(value) &&
    isRelativeUrl(value)

  if (!looksLikeFile) {
    return false
  }

  // Find the node used for this example.
  let node = nodes.find(n => _.get(n, key) === value)

  if (!node) {
    // Try another search as our "key" isn't always correct e.g.
    // it doesn't support arrays so the right key could be "a.b[0].c" but
    // this function will get "a.b.c".
    //
    // We loop through every value of nodes until we find
    // a match.
    const visit = (current, selector = [], fn) => {
      for (let i = 0, keys = Object.keys(current); i < keys.length; i++) {
        const key = keys[i]
        const value = current[key]

        if (value === undefined || value === null) continue

        if (typeof value === `object` || typeof value === `function`) {
          visit(current[key], selector.concat([key]), fn)
          continue
        }

        let proceed = fn(current[key], key, selector, current)

        if (proceed === false) {
          break
        }
      }
    }

    const isNormalInteger = str => /^\+?(0|[1-9]\d*)$/.test(str)

    node = nodes.find(n => {
      let isMatch = false
      visit(n, [], (v, k, selector, parent) => {
        if (v === value) {
          // Remove integers as they're for arrays, which our passed
          // in object path doesn't have.
          const normalizedSelector = selector
            .map(s => (isNormalInteger(s) ? `` : s))
            .filter(s => s !== ``)
          const fullSelector = `${normalizedSelector.join(`.`)}.${k}`
          if (fullSelector === key) {
            isMatch = true
            return false
          }
        }

        // Not a match so we continue
        return true
      })

      return isMatch
    })

    // Still no node.
    if (!node) {
      return false
    }
  }

  const rootNode = findRootNode(node)

  // Only nodes transformed (ultimately) from a File
  // can link to another File.
  if (rootNode.internal.type !== `File`) {
    return false
  }

  const pathToOtherNode = normalize(joinPath(rootNode.dir, value))
  const otherFileExists = getNodes().some(
    n => n.absolutePath === pathToOtherNode
  )
  return otherFileExists
}

function createType(fileNodeRootType, isArray) {
  if (!fileNodeRootType) return null

  return {
    type: isArray ? new GraphQLList(fileNodeRootType) : fileNodeRootType,
    resolve: (node, args, { path }, { fieldName }) => {
      let fieldValue = node[fieldName]

      if (!fieldValue) {
        return null
      }

      if (isArray && !_.isArray(fieldValue)) {
        // fieldValue is not array, so wrap value in single element array
        fieldValue = [fieldValue]
      }

      const findLinkedFileNode = relativePath => {
        // Use the parent File node to create the absolute path to
        // the linked file.
        const fileLinkPath = normalize(
          systemPath.resolve(parentFileNode.dir, relativePath)
        )

        // Use that path to find the linked File node.
        const linkedFileNode = _.find(
          getNodes(),
          n => n.internal.type === `File` && n.absolutePath === fileLinkPath
        )
        if (linkedFileNode) {
          createPageDependency({
            path,
            nodeId: linkedFileNode.id,
          })
          return linkedFileNode
        } else {
          return null
        }
      }

      // Find the File node for this node (we assume the node is something
      // like markdown which would be a child node of a File node).
      const parentFileNode = findRootNode(node)

      // Find the linked File node(s)
      if (isArray) {
        return fieldValue.map(relativePath => findLinkedFileNode(relativePath))
      } else {
        return findLinkedFileNode(fieldValue)
      }
    },
  }
}

export function shouldInfer(nodes, selector, value) {
  return (
    nodes[0].internal.type !== `File` &&
    ((_.isString(value) &&
      !_.isEmpty(value) &&
      pointsToFile(nodes, selector, value)) ||
      (_.isArray(value) &&
        _.isString(value[0]) &&
        !_.isEmpty(value[0]) &&
        pointsToFile(nodes, `${selector}[0]`, value[0])))
  )
}

export function getType() {
  return type
}

export function getListType() {
  return listType
}
