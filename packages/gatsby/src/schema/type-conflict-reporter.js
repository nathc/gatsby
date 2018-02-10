// @flow
const _ = require(`lodash`)
const report = require(`gatsby-cli/lib/reporter`)
const typeOf = require(`type-of`)
const util = require(`util`)
const { findRootNodeAncestor } = require(`../redux`)

const isNodeWithOrigin = node => node.internal && node.internal.origin

const findOrigin = obj => {
  if (obj) {
    const node = findRootNodeAncestor(obj, isNodeWithOrigin)
    if (node && node.internal && node.internal.origin) {
      return node.internal.origin
    }
  }
  return ``
}

const getMeaningfulTypeName = value => {
  if (_.isArray(value)) {
    const uniqueTypes = _.uniq(
      value.map(item => getMeaningfulTypeName(item))
    ).sort()
    return `array<${uniqueTypes.join(`|`)}>`
  } else {
    return typeOf(value)
  }
}

const squeezeValue = value =>
  _.isArray(value) ? _.uniqBy(value, typeOf) : value

class TypeConflictEntry {
  constructor(selector) {
    this.selector = selector
    this.types = {}
  }

  addExample({ value, parent }) {
    const typeName = getMeaningfulTypeName(value)
    this.types[typeName] = {
      value: squeezeValue(value),
      origin: findOrigin(parent),
    }
  }

  printEntry() {
    const sortedByTypeName = _.sortBy(
      _.entries(this.types),
      ([typeName, value]) => typeName
    )

    report.log(
      `${this.selector}:${sortedByTypeName
        .map(
          ([typeName, { value, origin }]) =>
            `\n - ${typeName}: ${util.inspect(value, {
              colors: true,
              depth: 0,
              breakLength: Infinity,
            })}${origin && ` (${origin})`}`
        )
        .join(``)}`
    )
  }
}

class TypeConflictVault {
  constructor() {
    this.entries = {}
  }

  _getFromSelector(selector) {
    if (this.entries[selector]) {
      return this.entries[selector]
    }

    const dataEntry = new TypeConflictEntry(selector)
    this.entries[selector] = dataEntry
    return dataEntry
  }

  addConflict(selector, ...examples) {
    const entry = this._getFromSelector(selector)
    examples
      .filter(example => example.value != null)
      .forEach(example => entry.addExample(example))
  }

  printConflicts() {
    const entries = _.values(this.entries)
    if (entries.length > 0) {
      report.warn(
        `There are conflicting field types in your data. GraphQL schema will omit those fields.`
      )
      entries.forEach(entry => entry.printEntry())
    }
  }
}

const typeConflictVault = new TypeConflictVault()

module.exports = typeConflictVault
