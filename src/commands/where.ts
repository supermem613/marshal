import { MarshalContext } from "../context.js";
import { requireBinding, BindingError } from "../binding.js";

export async function whereCommand(ctx: MarshalContext): Promise<number> {
  try {
    const b = requireBinding(ctx.homeDir);
    ctx.log.raw(b.dotfilesRepo + "\n");
    return 0;
  } catch (err) {
    if (err instanceof BindingError) {
      ctx.log.error(err.message);
      return 1;
    }
    throw err;
  }
}
