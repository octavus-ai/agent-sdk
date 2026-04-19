---
title: Types
description: Defining custom types for structured data in your agent protocol.
---

# Types

Types let you define reusable data structures for your agent. Use them in inputs, triggers, tools, resources, variables, and structured output responses.

## Why Types?

- **Reusability** - Define once, use in multiple places
- **Validation** - Catch errors at protocol validation time
- **Documentation** - Clear data contracts for your agent
- **Tool Parameters** - Use complex types in tool parameters
- **Structured Output** - Get typed JSON responses from the LLM

## Defining Types

Types are defined in the `types:` section using PascalCase names:

```yaml
types:
  Product:
    id:
      type: string
      description: Unique product identifier
    name:
      type: string
      description: Product display name
    price:
      type: number
      description: Price in cents
    inStock:
      type: boolean
      description: Whether the product is available
```

## Built-in Types

These scalar types can be used directly in inputs, resources, variables, triggers, and tool parameters:

| Type      | Description                           | Example Values                  |
| --------- | ------------------------------------- | ------------------------------- |
| `string`  | Text values                           | `"hello"`, `"user@example.com"` |
| `number`  | Numeric values (integers or decimals) | `42`, `3.14`, `-10`             |
| `integer` | Whole numbers only                    | `1`, `100`, `-5`                |
| `boolean` | True or false                         | `true`, `false`                 |
| `unknown` | Any value (no type checking)          | Any JSON value                  |
| `file`    | Uploaded file reference               | `{ id, mediaType, url, ... }`   |

The `file` type represents an uploaded file (image, document, etc.) with this structure:

```typescript
interface FileReference {
  id: string; // Unique file ID
  mediaType: string; // MIME type (e.g., 'image/png')
  url: string; // Presigned download URL
  filename?: string; // Original filename
  size?: number; // File size in bytes
}
```

> **Note:** There is no standalone `array` or `object` type. If you need typed arrays or objects, define a [custom type](#defining-types). If you don't care about the internal structure, use `unknown`.

## Array Shorthand

For simple arrays, use the `type[]` shorthand syntax:

```yaml
triggers:
  user-message:
    input:
      USER_MESSAGE:
        type: string
      FILES:
        type: file[] # Array of file references
        optional: true

variables:
  TAGS:
    type: string[] # Array of strings
```

This is equivalent to defining a top-level array type but more concise. Array shorthand works with any built-in type or custom type reference:

| Shorthand  | Equivalent To                 |
| ---------- | ----------------------------- |
| `string[]` | Array of strings              |
| `file[]`   | Array of file references      |
| `number[]` | Array of numbers              |
| `MyType[]` | Array of custom type `MyType` |

## Property Fields

Each property in a type can have these fields:

| Field         | Required | Description                                            |
| ------------- | -------- | ------------------------------------------------------ |
| `type`        | Yes      | The data type (built-in or custom type reference)      |
| `description` | No       | Human-readable description                             |
| `optional`    | No       | If `true`, property is not required (default: `false`) |
| `enum`        | No       | List of allowed string values                          |
| `const`       | No       | Fixed literal value (for discriminators)               |

### Required vs Optional

Properties are **required by default**. Use `optional: true` to make them optional:

```yaml
types:
  UserProfile:
    email:
      type: string
      description: User's email address

    phone:
      type: string
      description: User's phone number
      optional: true

    nickname:
      type: string
      optional: true
```

### Descriptions

Descriptions help document your types and guide LLM behavior:

```yaml
types:
  SupportTicket:
    priority:
      type: string
      enum: [low, medium, high, urgent]
      description: >
        Ticket priority level. Use 'urgent' only for critical issues
        affecting multiple users or causing data loss.
```

## Enums

Restrict string values to a specific set:

```yaml
types:
  OrderStatus:
    status:
      type: string
      enum: [pending, processing, shipped, delivered, cancelled]
      description: Current order status

    paymentMethod:
      type: string
      enum: [credit_card, paypal, bank_transfer]
```

## Arrays

There are two ways to define arrays:

### Array Properties

Define array properties within object types using `type: array` and an `items` definition:

```yaml
types:
  ShoppingCart:
    items:
      type: array
      items:
        type: CartItem
      description: Items in the cart

    tags:
      type: array
      items:
        type: string
      description: Cart tags for analytics

  CartItem:
    productId:
      type: string
    quantity:
      type: integer
```

### Top-Level Array Types

Define a named type that IS an array (not an object containing an array):

```yaml
types:
  CartItem:
    productId:
      type: string
      description: Product ID to add to cart
    quantity:
      type: integer
      description: Number of items (1-10)

  # Top-level array type - the type IS an array
  CartItemList:
    type: array
    items:
      type: CartItem
    description: List of cart items
```

Top-level array types are useful when you need to pass arrays as tool parameters without wrapping them in an object.

### Array Guidelines

When using arrays in structured output, use descriptions to guide the LLM on expected array sizes:

```yaml
types:
  Survey:
    answers:
      type: array
      items:
        type: string
      description: Survey answers (provide 1-10 responses)

  TopPicks:
    recommendations:
      type: array
      items:
        type: Product
      description: Top 3-5 product recommendations
```

> **Note:** Array length constraints (`minItems`, `maxItems`) are not enforced by LLM providers in structured output. Use descriptive prompts to guide the model.

## Type References

Reference other types by their PascalCase name:

```yaml
types:
  Address:
    street:
      type: string
    city:
      type: string
    country:
      type: string
    postalCode:
      type: string

  Customer:
    name:
      type: string
    email:
      type: string
    shippingAddress:
      type: Address
    billingAddress:
      type: Address
      optional: true
```

## Discriminated Unions

Create types that can be one of several variants using `anyOf`. Each variant must have a discriminator field with a unique `const` value:

```yaml
types:
  PaymentResult:
    anyOf:
      - PaymentSuccess
      - PaymentFailure
    discriminator: status

  PaymentSuccess:
    status:
      type: string
      const: success
    transactionId:
      type: string
      description: Unique transaction identifier
    amount:
      type: number
      description: Amount charged in cents

  PaymentFailure:
    status:
      type: string
      const: failure
    errorCode:
      type: string
      description: Error code for the failure
    message:
      type: string
      description: Human-readable error message
```

### Union Requirements

- Use `anyOf` with an array of type names (minimum 2)
- Specify a `discriminator` field name
- Each variant must have the discriminator field with a unique `const` value

### Multiple Unions

You can have multiple discriminated unions:

```yaml
types:
  ApiResponse:
    anyOf:
      - SuccessResponse
      - ErrorResponse
    discriminator: status

  SuccessResponse:
    status:
      type: string
      const: success
    data:
      type: unknown

  ErrorResponse:
    status:
      type: string
      const: error
    message:
      type: string

  UserAction:
    anyOf:
      - ClickAction
      - ScrollAction
      - SubmitAction
    discriminator: type

  ClickAction:
    type:
      type: string
      const: click
    elementId:
      type: string

  ScrollAction:
    type:
      type: string
      const: scroll
    position:
      type: number

  SubmitAction:
    type:
      type: string
      const: submit
    formData:
      type: unknown
```

## Complete Example

Here's a comprehensive example combining multiple type features:

```yaml
types:
  # Simple object type
  Price:
    amount:
      type: number
      description: Price amount
    currency:
      type: string
      enum: [USD, EUR, GBP]
      description: Currency code

  # Type with references and arrays
  Product:
    id:
      type: string
    name:
      type: string
    price:
      type: Price
    category:
      type: string
      enum: [electronics, clothing, home, sports]
    tags:
      type: array
      items:
        type: string
      description: Product tags (up to 10)
      optional: true

  # Discriminated union
  SearchResult:
    anyOf:
      - ProductResult
      - CategoryResult
    discriminator: resultType

  ProductResult:
    resultType:
      type: string
      const: product
    product:
      type: Product
    relevanceScore:
      type: number

  CategoryResult:
    resultType:
      type: string
      const: category
    categoryName:
      type: string
    productCount:
      type: integer

input:
  STORE_NAME:
    type: string

triggers:
  user-message:
    input:
      USER_MESSAGE:
        type: string

tools:
  search-products:
    description: Search the product catalog
    parameters:
      query:
        type: string
      category:
        type: string
        optional: true

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  tools: [search-products]
  agentic: true
```

## Using Types in Tools

Custom types can be used in tool parameters. Tool calls are always objects where each parameter name maps to a value.

### Basic Tool Parameters

```yaml
tools:
  get-product:
    description: Getting product details
    parameters:
      productId:
        type: string
      includeReviews:
        type: boolean
        optional: true
```

The LLM calls this with: `{ productId: "prod-123", includeReviews: true }`

### Array Parameters

For array parameters, define a top-level array type and use it as the parameter type:

```yaml
types:
  CartItem:
    productId:
      type: string
      description: Product ID to add to cart
    quantity:
      type: integer
      description: Number of items (1-10)
    giftWrap:
      type: boolean
      description: Whether to gift wrap this item
      optional: true

  # Top-level array type - the type IS an array
  CartItemList:
    type: array
    items:
      type: CartItem
    description: List of cart items

tools:
  add-to-cart:
    description: Adding products to cart
    display: description
    parameters:
      cartItems:
        type: CartItemList
        description: Items to add to the cart
```

The tool receives: `{ cartItems: [{ productId: "...", quantity: 1 }, ...] }`

### Why Use Named Array Types?

Named array types provide:

- **Reusability** - Use the same array type in multiple tools
- **Clear schema** - The array structure is validated
- **Clean tool calls** - No unnecessary wrapper objects

## Structured Output

Use `responseType` on a `next-message` block to get structured JSON responses instead of plain text.

### Basic Example

```yaml
types:
  ChatResponse:
    content:
      type: string
      description: The main response text to the user
    suggestions:
      type: array
      items:
        type: string
      description: 1-3 follow-up suggestions (empty array if none)

variables:
  RESPONSE:
    type: ChatResponse

handlers:
  user-message:
    Respond to user:
      block: next-message
      responseType: ChatResponse
      output: RESPONSE
```

### Discriminated Unions for Response Variants

When you need different response formats based on context, use a discriminated union **wrapped in an object**. LLM providers don't allow `anyOf` (discriminated unions) at the schema root, so you must wrap them.

```yaml
types:
  # ✅ Wrapper object (required - responseType must be an object, not a union)
  ChatResponseWrapper:
    response:
      type: ChatResponseUnion
      description: The response variant

  # Discriminated union with 3 variants
  ChatResponseUnion:
    anyOf:
      - ContentOnlyResponse
      - ContentWithSuggestionsResponse
      - ContentWithProductsResponse
    discriminator: responseType

  ContentOnlyResponse:
    responseType:
      type: string
      const: content
    content:
      type: string

  ContentWithSuggestionsResponse:
    responseType:
      type: string
      const: content_with_suggestions
    content:
      type: string
    suggestions:
      type: array
      items:
        type: string

  ContentWithProductsResponse:
    responseType:
      type: string
      const: content_with_products
    content:
      type: string
    recommendedProducts:
      type: array
      items:
        type: ProductSummary

handlers:
  user-message:
    Respond to user:
      block: next-message
      responseType: ChatResponseWrapper # Use the wrapper, not the union directly
```

The client receives an object like `{ response: { responseType: "content_with_suggestions", content: "...", suggestions: [...] } }`.

### Response Type Requirements

The `responseType` must be an **object type** (regular custom type with properties).

The following cannot be used directly as `responseType`:

- **Discriminated unions** - LLM providers don't allow `anyOf` at the schema root ([OpenAI docs](https://platform.openai.com/docs/guides/structured-outputs#root-objects-must-not-be-anyof-and-must-be-an-object))
- **Array types** - Must be wrapped in an object
- **Primitives** - `string`, `number`, etc. are not valid

```yaml
types:
  # ❌ Cannot use discriminated union directly as responseType
  ChatResponseUnion:
    anyOf: [ContentResponse, ProductResponse]
    discriminator: type

  # ✅ Wrap the union in an object
  ChatResponseWrapper:
    response:
      type: ChatResponseUnion

  # ❌ Cannot use array type as responseType
  ProductList:
    type: array
    items:
      type: Product

  # ✅ Wrap the array in an object
  ProductListResponse:
    products:
      type: array
      items:
        type: Product
      description: List of products
```

### How It Works

1. The LLM generates a structured JSON response matching the type schema
2. The response is validated against the schema
3. The parsed object is stored in the `output` variable (if specified)
4. The client SDK receives an `object` part instead of a `text` part

### Client-Side Rendering

When `responseType` is set, the client SDK receives a `UIObjectPart` that can be rendered with custom UI. See the [Structured Output](/docs/client-sdk/structured-output) guide for details on building custom renderers.

### Best Practices

**Use descriptions to guide the LLM:**

```yaml
types:
  ChatResponse:
    content:
      type: string
      description: >
        The main response to the user. Use markdown formatting
        for lists and code blocks when appropriate.
    suggestions:
      type: array
      items:
        type: string
      description: >
        2-3 natural follow-up questions the user might ask.
        Return an empty array if no suggestions are relevant.
```

**Keep types focused:**

Create separate types for different response formats rather than one complex type with many optional fields. Use discriminated unions when the response can be one of several distinct variants.

**Handle streaming gracefully:**

The client receives partial objects during streaming. Design your UI to handle incomplete data (e.g., show skeleton loaders for missing fields).

## Naming Conventions

| Element        | Convention                        | Examples                                |
| -------------- | --------------------------------- | --------------------------------------- |
| Type names     | PascalCase                        | `Product`, `UserProfile`, `OrderStatus` |
| Property names | camelCase                         | `firstName`, `orderId`, `isActive`      |
| Enum values    | lowercase_snake_case or camelCase | `in_stock`, `pending`, `creditCard`     |

## Validation

Types are validated when the protocol is loaded:

- Type names must be PascalCase
- Referenced types must exist
- Circular references are not allowed
- Union variants must have unique discriminator values
- Arrays with `type: array` must have an `items` definition

## Limitations

### Type Definition Limits

- **No standalone `array` or `object`** - Define a custom type instead, or use `unknown` for untyped data
- **No recursive types** - A type cannot reference itself (directly or indirectly)
- **No generic types** - Types are concrete, not parameterized
- **String enums only** - `enum` values must be strings
- **No array constraints** - `minItems` and `maxItems` are not supported (LLM providers don't enforce them)

### Tool Limitations

- **Tool parameters are always objects** - Each tool call is `{ param1: value1, param2: value2, ... }`
- **Array parameters need named types** - Use top-level array types for array parameters

### Structured Output Limitations

- **responseType must be an object type** - Only object types can be used as responseType
- **Discriminated unions need object wrapper** - Unions (`anyOf`) are not allowed at the schema root
- **Array types need object wrapper** - Arrays cannot be used directly as responseType
- **Primitives are not allowed** - `string`, `number`, etc. cannot be used as responseType

These limitations exist because LLM providers (OpenAI, Anthropic) require the root schema to be an object:

- [OpenAI: Root objects must not be anyOf](https://platform.openai.com/docs/guides/structured-outputs#root-objects-must-not-be-anyof-and-must-be-an-object)
- JSON Schema validation works best with explicit object structures at the root
