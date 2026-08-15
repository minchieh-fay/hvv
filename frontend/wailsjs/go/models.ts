export namespace main {
	
	export class Character {
	    id: string;
	    name: string;
	    description: string;
	    voice: string;
	
	    static createFrom(source: any = {}) {
	        return new Character(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.voice = source["voice"];
	    }
	}
	export class Location {
	    id: string;
	    name: string;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new Location(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	    }
	}
	export class Scene {
	    id: string;
	    title: string;
	    duration: number;
	    location: string;
	    characters: string[];
	    description: string;
	    dialogue: string;
	    prompt: string;
	    status: string;
	    imagePath?: string;
	    videoPath?: string;
	
	    static createFrom(source: any = {}) {
	        return new Scene(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.duration = source["duration"];
	        this.location = source["location"];
	        this.characters = source["characters"];
	        this.description = source["description"];
	        this.dialogue = source["dialogue"];
	        this.prompt = source["prompt"];
	        this.status = source["status"];
	        this.imagePath = source["imagePath"];
	        this.videoPath = source["videoPath"];
	    }
	}
	export class Project {
	    name: string;
	    format: string;
	    duration: number;
	    story: string;
	    characters: Character[];
	    locations: Location[];
	    scenes: Scene[];
	    audioPath?: string;
	    subtitlePath?: string;
	    finalPath?: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.format = source["format"];
	        this.duration = source["duration"];
	        this.story = source["story"];
	        this.characters = this.convertValues(source["characters"], Character);
	        this.locations = this.convertValues(source["locations"], Location);
	        this.scenes = this.convertValues(source["scenes"], Scene);
	        this.audioPath = source["audioPath"];
	        this.subtitlePath = source["subtitlePath"];
	        this.finalPath = source["finalPath"];
	        this.updatedAt = source["updatedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PlanRequest {
	    story: string;
	    project: Project;
	    characters: Character[];
	    locations: Location[];
	
	    static createFrom(source: any = {}) {
	        return new PlanRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.story = source["story"];
	        this.project = this.convertValues(source["project"], Project);
	        this.characters = this.convertValues(source["characters"], Character);
	        this.locations = this.convertValues(source["locations"], Location);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class Settings {
	    apiKey: string;
	    domain: string;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiKey = source["apiKey"];
	        this.domain = source["domain"];
	    }
	}

}

