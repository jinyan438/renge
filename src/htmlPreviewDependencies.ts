import lodash from "lodash";
import * as zod from "zod";

// This entry is bundled as a classic script for each isolated HTML document.
// Card scripts may read these globals immediately, including from a classic
// script in <head>, so an asynchronous module import would race their startup.
Object.assign(globalThis, {
  _: lodash,
  z: { ...zod, ...zod.z, default: zod.z, z: zod.z },
});
