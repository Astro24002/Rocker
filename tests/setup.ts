import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
