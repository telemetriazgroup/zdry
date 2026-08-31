import { ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { firstValueFrom, isObservable } from "rxjs";
import { IS_PUBLIC_KEY } from "./public.decorator";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const run = async () => {
      const result = super.canActivate(context);
      if (isObservable(result)) return firstValueFrom(result);
      return result as boolean | Promise<boolean>;
    };
    if (isPublic) {
      try {
        await run();
      } catch {
        /* anónimo */
      }
      return true;
    }
    return (await run()) as boolean;
  }
}
