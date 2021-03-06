// tslint:disable
export const schema = {{{schema}}};

export class InternalServerError extends Error {
  public readonly name = 'InternalServerError';
}

{{#exceptions}}
export class {{name}} extends Error {
  public readonly name = '{{name}}';
}

{{/exceptions}}
{{#enums}}
export enum {{name}} {
  {{#def}}
  {{{key}}} = {{{value}}},
  {{/def}}
}

{{/enums}}
{{#bypassTypes}}
export type {{name}} = {{{def}}};

{{/bypassTypes}}
{{#classes}}
export interface {{name}} {
  {{#attributes}}
  readonly {{name}}{{#optional}}?{{/optional}}: {{{type}}};
  {{/attributes}}
  {{#methods}}
  {{name}}({{#parameters}}{{name}}{{#optional}}?{{/optional}}: {{{type}}}{{^last}}, {{/last}}{{/parameters}}): Promise<{{{returnType}}}>;
  {{/methods}}
}

{{/classes}}
