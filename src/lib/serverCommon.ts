import { fromPairs, isPlainObject, merge } from 'lodash';
import { createClassValidator, ValidationError } from './common';

export function validateClass(schema: { definitions: any }, className: string) {
  const props = schema.definitions[className].properties;
  const clientContext = props.clientContext || schema.definitions.ClientContext;
  const overrides: any = clientContext
    ? fromPairs(Object.keys(props).map((method: string) => [
      method, {
        properties: {
          params: {
            properties: {
              ctx: clientContext,
            },
          },
        },
      },
    ]))
  : {};
  const schemaWithContextParam = merge({}, schema, { definitions: { [className]: { properties: overrides } } });
  const validators = createClassValidator(schemaWithContextParam, className, 'params');

  return (method: string, body: any): void => {
    const validator = validators[method];
    if (!validator) {
      throw new ValidationError('Bad Request', [{ message: 'Method not supported', method }]);
    }
    if (!isPlainObject(body)) {
      throw new ValidationError('Bad Request', [{ message: 'Could not parse body', method }]);
    }

    const { context, args, ...rest } = body;
    if (args && Object.keys(rest).length === 0) {
      delete body.args;
      Object.assign(body, args);
      if (context) {
        body.ctx = context;
        delete body.context;
      }
    }
    if (!validator(body)) {
      throw new ValidationError('Bad Request', validator.errors);
    }
  };
}

export function validateMethod(schema: { definitions: any }, className: string, method: string) {
  const classValidator = validateClass(schema, className);
  return (body: any) => {
    classValidator(method, body);
  };
}
