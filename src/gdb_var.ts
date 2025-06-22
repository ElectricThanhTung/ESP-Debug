
import { Variable } from '@vscode/debugadapter';

export class GdbVar {
    private id;
    private name;
    private expr;
    private data;

    public constructor(id: number, name: string, expr: string, data: any) {
        this.id = id;
        this.name = name;
        this.expr = expr;
        this.data = data;
    }

    public getId(): number {
        return this.id;
    }

    public getName(): string {
        return this.name;
    }

    public getExpression() {
        return this.expr;
    }

    public toVariable(displayName: string): Variable {
        const refer = (parseInt(this.data.numchild) > 0) ? this.id : 0;
        const value = (this.data.value !== undefined) ? this.data.value : 'not available';
        return new Variable(displayName, value, refer);
    }
}
