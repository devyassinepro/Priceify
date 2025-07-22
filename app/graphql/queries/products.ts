export const GET_PRODUCTS = `
  query getProducts($first: Int, $last: Int, $after: String, $before: String) {
    products(first: $first, last: $last, after: $after, before: $before) {
      edges {
        node {
          id
          title
          handle
          status
          vendor
          productType
          images(first: 1) {
            edges {
              node {
                url
                altText
              }
            }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
                inventoryQuantity
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

export const GET_PRODUCT_BY_ID = `
  query getProduct($id: ID!) {
    product(id: $id) {
      id
      title
      description
      handle
      status
      vendor
      productType
      images(first: 5) {
        edges {
          node {
            url
            altText
          }
        }
      }
      variants(first: 100) {
        edges {
          node {
            id
            title
            price
            compareAtPrice
            inventoryQuantity
            sku
          }
        }
      }
    }
  }
`;