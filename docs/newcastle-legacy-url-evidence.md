# Newcastle retired product URL evidence

On 20 August 2026, browser navigation to `http://www.newcastleis.co.uk/products.aspx?ref=www.criteriahub.co.uk` redirected to `https://newcastleforintermediaries.co.uk/?ref=www.criteriahub.co.uk`.

The resulting homepage displayed an intermediary notice and links labelled **See products** and **Explore products**, both pointing to `/products/our-product-range`. It did not render product-card rate data itself. The browser was able to read the public homepage, so this behaviour is a retired-URL redirect rather than evidence of a UK IP restriction.

The browser capture layer maps this retired endpoint to `https://newcastleforintermediaries.co.uk/products/our-product-range`, where the live product cards are rendered.
