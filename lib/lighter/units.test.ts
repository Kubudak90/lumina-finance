import { describe, expect, it } from "vitest";
import {
  displayPriceToReal as officialDisplayPriceToReal,
  displaySizeToReal as officialDisplaySizeToReal,
  getDisplayDecimals as officialGetDisplayDecimals,
  realPriceToDisplay as officialRealPriceToDisplay,
  realSizeToDisplay as officialRealSizeToDisplay,
} from "../../node_modules/lighter-ts/dist/utils/multiplier.js";
import {
  displayPriceToReal,
  displaySizeToReal,
  getDisplayDecimals,
  realPriceToDisplay,
  realSizeToDisplay,
} from "./units";

const sizeParams = { multiplier: "0.001", display_size_decimals: 4 };
const priceParams = { multiplier: "0.001", display_price_decimals: 2 };
const realSizeParams = { multiplier: "0.001", size_decimals: 3 };
const realPriceParams = {
  multiplier: "0.001",
  price_decimals: 5,
  display_price_decimals: 2,
};
const integerMarket = {
  multiplier: "1",
  price_decimals: 2,
  size_decimals: 4,
  display_size_decimals: 4,
  display_price_decimals: 2,
};

describe("Lighter multiplier helpers", () => {
  it("match official lighter-ts formulas for size and price", () => {
    const sizes = [0, 1, 12.345, 1000, "0.0001"];
    for (const size of sizes) {
      expect(realSizeToDisplay(size, sizeParams)).toBe(officialRealSizeToDisplay(size, sizeParams));
      expect(displaySizeToReal(size, realSizeParams)).toBe(officialDisplaySizeToReal(size, realSizeParams));
    }

    const prices = [0, 1, 2500.5, 0.01, "123.456"];
    for (const price of prices) {
      expect(realPriceToDisplay(price, priceParams)).toBe(officialRealPriceToDisplay(price, priceParams));
      expect(displayPriceToReal(price, realPriceParams, false)).toBe(
        officialDisplayPriceToReal(price, realPriceParams, false)
      );
      expect(displayPriceToReal(price, realPriceParams, true)).toBe(
        officialDisplayPriceToReal(price, realPriceParams, true)
      );
    }

    expect(realSizeToDisplay(1, integerMarket)).toBe(officialRealSizeToDisplay(1, integerMarket));
    expect(realPriceToDisplay(100, integerMarket)).toBe(officialRealPriceToDisplay(100, integerMarket));
  });

  it("match official display-decimal derivation", () => {
    expect(getDisplayDecimals({ price_decimals: 5, size_decimals: 3, multiplier: "0.001" })).toEqual(
      officialGetDisplayDecimals({ price_decimals: 5, size_decimals: 3, multiplier: "0.001" })
    );
    expect(getDisplayDecimals({ price_decimals: 2, size_decimals: 4, multiplier: "10" })).toEqual(
      officialGetDisplayDecimals({ price_decimals: 2, size_decimals: 4, multiplier: "10" })
    );
    expect(getDisplayDecimals({ price_decimals: 2, size_decimals: 4, multiplier: "1" })).toEqual(
      officialGetDisplayDecimals({ price_decimals: 2, size_decimals: 4, multiplier: "1" })
    );
  });
});
