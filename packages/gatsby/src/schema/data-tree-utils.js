// @flow
const _ = require(`lodash`)
const flatten = require(`flat`)
const typeOf = require(`type-of`)

const createKey = require(`./create-key`)
const typeConflictReporter = require(`./type-conflict-reporter`)

const INVALID_VALUE = Symbol(`INVALID_VALUE`)
const isDefined = v => v != null

const isSameType = (a, b) => a == null || b == null || typeOf(a) === typeOf(b)
const areAllSameType = list =>
  list.every((current, i) => {
    let prev = i ? list[i - 1] : undefined
    return isSameType(prev, current)
  })

const isEmptyObjectOrArray = (obj: any): boolean => {
  if (obj === INVALID_VALUE) {
    return true
  } else if (_.isDate(obj)) {
    return false
    // Simple "is object empty" check.
  } else if (_.isObject(obj) && _.isEmpty(obj)) {
    return true
  } else if (_.isObject(obj)) {
    return _.every(obj, (value, key) => {
      if (!isDefined(value)) {
        return true
      } else if (_.isObject(value)) {
        return isEmptyObjectOrArray(value)
      } else {
        return false
      }
    })
  }
  return false
}

/**
 * Takes an array of source nodes and returns a pristine
 * example that can be used to infer types.
 *
 * Arrays are flattened to either: `null` for empty or sparse arrays or a
 * an array of a sigle merged example. e.g:
 *
 *  - ['red'], ['blue', 'yellow'] -> ['red']
 *  - [{ color: 'red'}, { color: 'blue', ht: 5 }] -> [{ color: 'red', ht: 5 }]
 *
 * @param {*Nodes} args
 * @param {string} selector path to field we extract example values from
 */
const extractFieldExamples = (nodes: any[], selector: ?string) => {
  const valuesAndSources = _.assignWith(
    _.isArray(nodes[0]) ? [] : {},
    ..._.clone(nodes),
    (current, nextValue, key, accumulator, nextParent) => {
      // If this is first item in array value will be undefined.
      // Init value with nulls
      if (typeof current === `undefined`) {
        current = {
          value: null,
          parent: null,
        }
      }
      // Track both value and its parent (object or array containing this value)
      let { value, parent } = current

      const nextSelector = selector && `${selector}.${key}`

      // If we found conflict earlier - try to add next values
      // to display all possible conflicts
      if (value === INVALID_VALUE) {
        if (nextSelector && nextValue) {
          typeConflictReporter.addConflict(nextSelector, {
            value: nextValue,
            parent: nextParent,
          })
        }
        // keep previously found INVALID_VALUE
        return current
      }

      // TODO: if you want to support infering Union types this should be handled
      // differently. Maybe merge all like types into examples for each type?
      // e.g. union: [1, { foo: true }, ['brown']] -> Union Int|Object|List
      if (!isSameType(value, nextValue)) {
        if (nextSelector) {
          typeConflictReporter.addConflict(nextSelector, current, {
            value: nextValue,
            parent: nextParent,
          })
        }
        return { value: INVALID_VALUE, parent }
      }

      if (_.isPlainObject(value || nextValue)) {
        return {
          value: extractFieldExamples([value, nextValue], nextSelector),
          // This is tricky - we can't correctly define parent as extracted
          // value will be merged from both objects so we will possibly
          // report conflict with merged object (not actual value).
          // We could store actual value in another field
          parent: value ? parent : nextParent,
        }
      }

      if (!_.isArray(value || nextValue)) {
        // Prefer floats over ints as they're more specific.
        if (value && _.isNumber(value) && !_.isInteger(value)) {
          return { value, parent }
        } else if (value === null) {
          return { value: nextValue, parent: nextParent }
        } else {
          return { value, parent }
        }
      }

      // Filter before concatenating to know source of passed data
      value = value ? value.filter(isDefined) : []
      nextValue = nextValue ? nextValue.filter(isDefined) : []

      let array = [].concat(value, nextValue)

      if (!array.length) {
        return { value: null, parent }
      }
      if (!areAllSameType(array)) {
        if (nextSelector) {
          typeConflictReporter.addConflict(nextSelector, current, {
            value: nextValue,
            parent: nextParent,
          })
        }
        return { obj: INVALID_VALUE, parent: parent || nextParent }
      }

      // Linked node arrays don't get reduced further as we
      // want to preserve all the linked node types.
      if (_.includes(key, `___NODE`)) {
        return { value: array, parent }
      }

      // primitive values and dates don't get merged further, just take the first item
      if (!_.isObject(array[0]) || array[0] instanceof Date) {
        return {
          value: array.slice(0, 1),
          parent: value.length ? parent : nextParent,
        }
      }
      let merged = extractFieldExamples(
        array,
        nextSelector && `${nextSelector}[]`
      )
      return {
        value: isDefined(merged) ? [merged] : null,
        parent: value.length ? parent : nextParent,
      }
    }
  )
  // Unpack values and discard source as it's not needed anymore
  return _.mapValues(valuesAndSources, ({ value }) => value)
}

const buildFieldEnumValues = (nodes: any[]) => {
  const enumValues = {}
  const values = flatten(extractFieldExamples(nodes), {
    maxDepth: 3,
    safe: true, // don't flatten arrays.
    delimiter: `___`,
  })
  Object.keys(values).forEach(field => {
    if (values[field] == null) return
    enumValues[createKey(field)] = { field }
  })

  return enumValues
}

// extract a list of field names
// nested objects get flattened to "outer___inner" which will be converted back to
// "outer.inner" by run-sift
const extractFieldNames = (nodes: any[]) => {
  const values = flatten(extractFieldExamples(nodes), {
    maxDepth: 3,
    safe: true, // don't flatten arrays.
    delimiter: `___`,
  })

  return Object.keys(values)
}

module.exports = {
  INVALID_VALUE,
  extractFieldExamples,
  buildFieldEnumValues,
  extractFieldNames,
  isEmptyObjectOrArray,
}
