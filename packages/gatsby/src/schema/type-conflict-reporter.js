// @flow

const _ = require(`lodash`)
const report = require(`gatsby-cli/lib/reporter`)
const typeOf = require(`type-of`)

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

class TypeConflictEntry {
  constructor(selector) {
    this.selector = selector
    this.types = []
  }

  addValue(value) {
    const typeName = getMeaningfulTypeName(value)
    if (!_.includes(this.types, typeName)) {
      this.types.push(typeName)
    }
  }

  printEntry() {
    report.log(`${this.selector}: ${this.types.sort().join(`, `)}`)
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

  addConflict(selector, ...values) {
    const entry = this._getFromSelector(selector)
    values
      .filter(value => typeof value !== `undefined`)
      .forEach(value => entry.addValue(value))
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
