
import { Variable } from '@vscode/debugadapter';

export class GdbVar {
    private id;
    private data;

    public constructor(id: number, data: any) {
        this.id = id;
        this.data = data;
    }

    public getId(): number {
        return this.id;
    }

    public toVariable(displayName: string): Variable {
        const refer = (parseInt(this.data.numchild) > 0) ? this.id : 0;
        return new Variable(displayName, this.data.value, refer);
    }
}
