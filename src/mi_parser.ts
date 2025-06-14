
export class MIParser {
    private static getEndIndexOfString(str: string, index: number): number {
        if(str[index] == '"')
            index++;
        while(index < str.length) {
            if(str[index] === '\\')
                index++;
            else if(str[index] === '"')
                return index;
            index++;
        }
        return index;
    }

    private static getEndIndexOfArray(str: string, index: number) {
        let count = 0;
        while(index < str.length) {
            if(str[index] === '[')
                count++;
            else if(str[index] === ']') {
                count--;
                if(count === 0)
                    return index;
                else if(count < 0)
                    throw new Error('Invalid GDB machine interface string');
            }
            index++;
        }
        return index;
    }

    private static getEndIndexOfObject(str: string, index: number) {
        let count = 0;
        while(index < str.length) {
            if(str[index] === '{')
                count++;
            else if(str[index] === '}') {
                count--;
                if(count === 0)
                    return index;
                else if(count < 0)
                    throw new Error('Invalid GDB machine interface string');
            }
            index++;
        }
        return index;
    }

    private static separateElements(str: string): string[] {
        const keyValuePairs: string[] = [];
        let start = 0;
        for(let i = 0; i < str.length; i++) {
            if(str[i] === ',') {
                keyValuePairs.push(str.substring(start, i));
                start = i + 1;
            }
            else if(str[i] === '"')
                i = MIParser.getEndIndexOfString(str, i);
            else if(str[i] === '[')
                i = MIParser.getEndIndexOfArray(str, i);
            else if(str[i] === '{')
                i = MIParser.getEndIndexOfObject(str, i);
        }
        if(start < str.length)
            keyValuePairs.push(str.substring(start));
        return keyValuePairs;
    }

    private static parseString(str: string): string {
        for(let i = 1; i < str.length; i++) {
            if(str[i] === '"')
                return JSON.parse(`"${str.substring(1, i)}"`);
        }
        throw new Error('Invalid GDB machine interface string');
    }

    private static parseArray(str: string): any[] {
        const values: any[] = [];
        const elements = MIParser.separateElements(str.substring(1, str.length - 1));
        for(let i = 0; i < elements.length; i++)
            values.push(MIParser.parseValues(elements[i]));
        return values;
    }

    public static parseObject(str: string): Record<string, any> {
        const values: Record<string, any> = {};
        const elements = MIParser.separateElements(str);
        for(let i = 0; i < elements.length; i++) {
            const pair = elements[i];
            const index = pair.indexOf('=');
            const key = pair.substring(0, index);
            values[key] = MIParser.parseValues(pair.substring(index + 1));
        }
        return values;
    }

    public static parseValues(str: string): any {
        if(str[0] === '"')
            return MIParser.parseString(str);
        else if(str[0] === '[')
            return MIParser.parseArray(str);
        else if(str[0] === '{')
            return MIParser.parseObject(str.substring(1, str.length - 1));
        else
            return MIParser.parseObject(str);
    }

    public static parser(str: string): Record<string, any> {
        const endOfTypeIndex = str.indexOf(',');
        const type = str.substring(1, endOfTypeIndex);
        return MIParser.parseValues(str.substring(endOfTypeIndex + 1));
    }
}
