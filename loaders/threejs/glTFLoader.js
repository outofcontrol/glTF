/**
 * @author Tony Parisi / http://www.tonyparisi.com/
 */


THREE.glTFLoader = function ( context, showStatus ) {
    THREE.Loader.call( this, showStatus );

    // Utilities

    function RgbArraytoHex(colorArray) {
        if(!colorArray) return 0xFFFFFFFF;
        var r = Math.floor(colorArray[0] * 255),
            g = Math.floor(colorArray[1] * 255),
            b = Math.floor(colorArray[2] * 255),
            a = 255;

        var color = (a << 24) + (r << 16) + (g << 8) + b;

        return color;
    }

    function componentsPerElementForGLType(glType) {
        switch (glType) {
            case "FLOAT" :
            case "UNSIGNED_BYTE" :
            case "UNSIGNED_SHORT" :
                return 1;
            case "FLOAT_VEC2" :
                return 2;
            case "FLOAT_VEC3" :
                return 3;
            case "FLOAT_VEC4" :
                return 4;
            default:
                return null;
        }
    }


    function LoadTexture(src) {
        if(!src) { return null; }
        return THREE.ImageUtils.loadTexture(src);
    }

    // Geometry processing

    var ClassicGeometry = function() {

    	this.geometry = new THREE.Geometry;
        this.totalAttributes = 0;
        this.loadedAttributes = 0;
        this.indicesLoaded = false;
        this.finished = false;

        this.onload = null;

        this.uvs = null;
        this.indexArray = null;
    };

    ClassicGeometry.prototype.constructor = ClassicGeometry;

    ClassicGeometry.prototype.checkFinished = function() {
        if(this.indexArray && this.loadedAttributes === this.totalAttributes) {
            // Build indexed mesh
            var geometry = this.geometry;
            var normals = geometry.normals;
            var indexArray = this.indexArray;
            var uvs = this.uvs;
            var a, b, c;
            var i, l;
            var faceNormals = null;
            var faceTexcoords = null;
            
            for(i = 0, l = this.indexArray.length; i < l; i += 3) {
                a = indexArray[i];
                b = indexArray[i+1];
                c = indexArray[i+2];
                if(normals) {
                    faceNormals = [normals[a], normals[b], normals[c]];
                }
                geometry.faces.push( new THREE.Face3( a, b, c, faceNormals, null, null ) );
                if(uvs) {
                    geometry.faceVertexUvs[0].push([ uvs[a], uvs[b], uvs[c] ]);
                }
            }

            // Allow Three.js to calculate some values for us
            geometry.computeCentroids();
            if(!normals) {
                geometry.computeFaceNormals();
            }

            this.finished = true;

            if(this.onload) {
                this.onload();
            }
        }
    };

    // Delegate for processing index buffers
    var IndicesDelegate = function() {};

    IndicesDelegate.prototype.handleError = function(errorCode, info) {
        // FIXME: report error
        console.log("ERROR(IndicesDelegate):"+errorCode+":"+info);
    };

    IndicesDelegate.prototype.convert = function(resource, ctx) {
        return new Uint16Array(resource, 0, ctx.indices.count);
    };

    IndicesDelegate.prototype.resourceAvailable = function(glResource, ctx) {
        var geometry = ctx.geometry;
        geometry.indexArray = glResource;
        geometry.checkFinished();
        return true;
    };

    var indicesDelegate = new IndicesDelegate();

    var IndicesContext = function(indices, geometry) {
        this.indices = indices;
        this.geometry = geometry;
    };
    
    // Delegate for processing vertex attribute buffers
    var VertexAttributeDelegate = function() {};

    VertexAttributeDelegate.prototype.handleError = function(errorCode, info) {
        // FIXME: report error
        console.log("ERROR(VertexAttributeDelegate):"+errorCode+":"+info);
    };

    VertexAttributeDelegate.prototype.convert = function(resource, ctx) {
        return resource;
    };




    VertexAttributeDelegate.prototype.resourceAvailable = function(glResource, ctx) {
        var geom = ctx.geometry;
        var attribute = ctx.attribute;
        var semantic = ctx.semantic;
        var floatArray;
        var i, l;
        //FIXME: Float32 is assumed here, but should be checked.

        if(semantic == "POSITION") {
            // TODO: Should be easy to take strides into account here
            floatArray = new Float32Array(glResource, 0, attribute.count * componentsPerElementForGLType(attribute.type));
            for(i = 0, l = floatArray.length; i < l; i += 3) {
                geom.geometry.vertices.push( new THREE.Vector3( floatArray[i], floatArray[i+1], floatArray[i+2] ) );
            }
        } else if(semantic == "NORMAL") {
            geom.geometry.normals = [];
            floatArray = new Float32Array(glResource, 0, attribute.count * componentsPerElementForGLType(attribute.type));
            for(i = 0, l = floatArray.length; i < l; i += 3) {
                geom.geometry.normals.push( new THREE.Vector3( floatArray[i], floatArray[i+1], floatArray[i+2] ) );
            }
        } else if ((semantic == "TEXCOORD_0") || (semantic == "TEXCOORD" )) {
        	geom.uvs = [];
            floatArray = new Float32Array(glResource, 0, attribute.count * componentsPerElementForGLType(attribute.type));
            for(i = 0, l = floatArray.length; i < l; i += 2) {
                geom.uvs.push( new THREE.Vector2( floatArray[i], 1.0 - floatArray[i+1] ) );
            }
        }
        geom.loadedAttributes++;
        geom.checkFinished();
        return true;
    };

    var vertexAttributeDelegate = new VertexAttributeDelegate();

    var VertexAttributeContext = function(attribute, semantic, geometry) {
        this.attribute = attribute;
        this.semantic = semantic;
        this.geometry = geometry;
    };

    var Mesh = function() {
        this.primitives = [];
        this.loadedGeometry = 0;
        this.onCompleteCallbacks = [];
    };

    Mesh.prototype.addPrimitive = function(geometry, material) {
        var self = this;
        geometry.onload = function() {
            self.loadedGeometry++;
            self.checkComplete();
        };
        this.primitives.push({
            geometry: geometry,
            material: material,
            mesh: null
        });
    };

    Mesh.prototype.onComplete = function(callback) {
        this.onCompleteCallbacks.push(callback);
        this.checkComplete();
    };

    Mesh.prototype.checkComplete = function() {
        var self = this;
        if(this.onCompleteCallbacks.length && this.primitives.length == this.loadedGeometry) {
            this.onCompleteCallbacks.forEach(function(callback) {
                callback(self);
            });
            this.onCompleteCallbacks = [];
        }
    };

    Mesh.prototype.attachToNode = function(threeNode) {
        // Assumes that the geometry is complete
        this.primitives.forEach(function(primitive) {
            /*if(!primitive.mesh) {
                primitive.mesh = new THREE.Mesh(primitive.geometry, primitive.material);
            }*/
            var threeMesh = new THREE.Mesh(primitive.geometry.geometry, primitive.material);
            primitive.material.side = THREE.FrontSide;
            threeMesh.castShadow = true;
            threeNode.add(threeMesh);
        });
    };

    // Resource management

    var ResourceEntry = function(entryID, object, description) {
        this.entryID = entryID;
        this.object = object;
        this.description = description;
    };

    var Resources = function() {
        this._entries = {};
    };

    Resources.prototype.setEntry = function(entryID, object, description) {
        if (!entryID) {
            console.error("No EntryID provided, cannot store", description);
            return;
        }

        if (this._entries[entryID]) {
            console.warn("entry["+entryID+"] is being overwritten");
        }
    
        this._entries[entryID] = new ResourceEntry(entryID, object, description );
    };
    
    Resources.prototype.getEntry = function(entryID) {
        return this._entries[entryID];
    };

    Resources.prototype.clearEntries = function() {
        this._entries = {};
    };

    LoadDelegate = function() {
    }
    
    LoadDelegate.prototype.loadCompleted = function(callback, obj) {
    	callback.call(obj);
    }
    
    // Loader

    var ThreeGLTFLoader = Object.create(WebGLTFLoader, {

        load: {
            enumerable: true,
            value: function(userInfo, options) {
                this.resources = new Resources();
                WebGLTFLoader.load.call(this, userInfo, options);
            }
        },

        binaryLoader: {
            value: null,
            writable: true

        },

        // Implement WebGLTFLoader handlers

        handleBuffer: {
            value: function(entryID, description, userInfo) {
                this.resources.setEntry(entryID, null, description);
                description.type = "ArrayBuffer";
                return true;
            }
        },

        handleBufferView: {
            value: function(entryID, description, userInfo) {
                this.resources.setEntry(entryID, null, description);

                var buffer =  this.resources.getEntry(description.buffer);
                description.type = "ArrayBufferView";

                var bufferViewEntry = this.resources.getEntry(entryID);
                bufferViewEntry.buffer = buffer;
                return true;
            }
        },

        handleShader: {
            value: function(entryID, description, userInfo) {
                // No shader handling at this time
                return true;
            }
        },

        handleProgram: {
            value: function(entryID, description, userInfo) {
                // No program handling at this time
                return true;
            }
        },

        handleTechnique: {
            value: function(entryID, description, userInfo) {
                // No technique handling at this time
                return true;
            }
        },

        handleMaterial: {
            value: function(entryID, description, userInfo) {
                //this should be rewritten using the meta datas that actually create the shader.
                //here we will infer what needs to be pass to Three.js by looking inside the technique parameters.
                var texturePath = null;
                var vals = description.instanceTechnique.values;
                var values = {};
                var i, len = vals.length;
                for (i = 0; i < len; i++)
                {
                	values[vals[i].parameter] = vals[i];
                }
                
                var diffuse = values.diffuse;
                if (diffuse)
                {
                	var texture = diffuse.value;
                    if (texture) {
                        var imageEntry = this.resources.getEntry(texture.image);
                        if (imageEntry) {
                            texturePath = imageEntry.description.path;
                        }
                    }                    
                }
                
                var diffuseColor = !texturePath ? diffuse.value : null;
                var transparency = values.transparency ? values.transparency.value : 1.0;

                var material = new THREE.MeshLambertMaterial({
                    color: RgbArraytoHex(diffuseColor),
                    opacity: transparency,
                    map: LoadTexture(texturePath)
                });

                this.resources.setEntry(entryID, material, description);

                return true;
            }
        },

        handleMesh: {
            value: function(entryID, description, userInfo) {
                var mesh = new Mesh();
                this.resources.setEntry(entryID, mesh, description);
                var primitivesDescription = description.primitives;
                if (!primitivesDescription) {
                    //FIXME: not implemented in delegate
                    console.log("MISSING_PRIMITIVES for mesh:"+ entryID);
                    return false;
                }

                for (var i = 0 ; i < primitivesDescription.length ; i++) {
                    var primitiveDescription = primitivesDescription[i];
                    
                    if (primitiveDescription.primitive === "TRIANGLES") {

                        var geometry = new ClassicGeometry();
                        var materialEntry = this.resources.getEntry(primitiveDescription.material);

                        mesh.addPrimitive(geometry, materialEntry.object);

                        var indices = this.resources.getEntry(primitiveDescription.indices);
                        var bufferEntry = this.resources.getEntry(indices.description.bufferView);
                        indices.bufferView = bufferEntry;
                        indices.byteOffset = indices.description.byteOffset;
                        indices.count = indices.description.count;
                        indices.id = indices.description.id;
                        indices.type = indices.description.type;
                        var indicesContext = new IndicesContext(indices, geometry);
                        var alreadyProcessedIndices = THREE.GLTFLoaderUtils.getBuffer(indices, indicesDelegate, indicesContext);
                        /*if(alreadyProcessedIndices) {
                            indicesDelegate.resourceAvailable(alreadyProcessedIndices, indicesContext);
                        }*/

                        // Load Vertex Attributes
                        var allSemantics = Object.keys(primitiveDescription.semantics);
                        allSemantics.forEach( function(semantic) {
                            geometry.totalAttributes++;

                            var attribute;
                            var attributeID = primitiveDescription.semantics[semantic];
                            var attributeEntry = this.resources.getEntry(attributeID);
                            if (!attributeEntry) {
                                //let's just use an anonymous object for the attribute
                                attribute = description.attributes[attributeID];
                                attribute.id = attributeID;
                                this.resources.setEntry(attributeID, attribute, attribute);
            
                                var bufferEntry = this.resources.getEntry(attribute.bufferView);
                                attribute.bufferView = bufferEntry;
                                attributeEntry = this.resources.getEntry(attributeID);

                            } else {
                                attribute = attributeEntry.object;
                                attribute.id = attributeID;
                                var bufferEntry = this.resources.getEntry(attribute.bufferView);
                                attribute.bufferView = bufferEntry;
                            }

                            var attribContext = new VertexAttributeContext(attribute, semantic, geometry);

                            var alreadyProcessedAttribute = THREE.GLTFLoaderUtils.getBuffer(attribute, vertexAttributeDelegate, attribContext);
                            /*if(alreadyProcessedAttribute) {
                                vertexAttributeDelegate.resourceAvailable(alreadyProcessedAttribute, attribContext);
                            }*/
                        }, this);
                    }
                }
                return true;
            }
        },

        handleCamera: {
            value: function(entryID, description, userInfo) {
                // No camera handling at this time
                return true;
            }
        },

        handleLight: {
            value: function(entryID, description, userInfo) {
                // No light handling at this time
                return true;
            }
        },

        handleNode: {
            value: function(entryID, description, userInfo) {

                var threeNode = new THREE.Object3D();
                threeNode.name = description.name;

                this.resources.setEntry(entryID, threeNode, description);

                var m = description.matrix;
                if(m) {
                    threeNode.matrixAutoUpdate = false;
                    threeNode.applyMatrix(new THREE.Matrix4(
                        m[0],  m[4],  m[8],  m[12],
                        m[1],  m[5],  m[9],  m[13],
                        m[2],  m[6],  m[10], m[14],
                        m[3],  m[7],  m[11], m[15]
                    ));
                }

                // Iterate through all node meshes and attach the appropriate objects
                //FIXME: decision needs to be made between these 2 ways, probably meshes will be discarded.
                var meshEntry;
                if (description.mesh) {
                    meshEntry = this.resources.getEntry(description.mesh);
                    meshEntry.object.onComplete(function(mesh) {
                        mesh.attachToNode(threeNode);
                    });
                }

                if (description.meshes) {
                    description.meshes.forEach( function(meshID) {
                        meshEntry = this.resources.getEntry(meshID);
                        meshEntry.object.onComplete(function(mesh) {
                            mesh.attachToNode(threeNode);
                        });
                    }, this);
                }

                /*if (description.camera) {
                    var cameraEntry = this.resources.getEntry(description.camera);
                    node.cameras.push(cameraEntry.entry);
                }*/

                return true;
            }
        },
        
        buildNodeHirerachy: {
            value: function(nodeEntryId, parentThreeNode) {
                var nodeEntry = this.resources.getEntry(nodeEntryId);
                var threeNode = nodeEntry.object;
                parentThreeNode.add(threeNode);

                var children = nodeEntry.description.children;
                if (children) {
                    children.forEach( function(childID) {
                        this.buildNodeHirerachy(childID, threeNode);
                    }, this);
                }

                return threeNode;
            }
        },

        handleScene: {
            value: function(entryID, description, userInfo) {

                if (!description.nodes) {
                    console.log("ERROR: invalid file required nodes property is missing from scene");
                    return false;
                }

                description.nodes.forEach( function(nodeUID) {
                    this.buildNodeHirerachy(nodeUID, userInfo.rootObj);
                }, this);

                if (this.delegate) {
                    this.delegate.loadCompleted(userInfo.callback, userInfo.rootObj);
                }

                return true;
            }
        },

        handleImage: {
            value: function(entryID, description, userInfo) {
                this.resources.setEntry(entryID, null, description);
                return true;
            }
        },
        
        handleAnimation: {
            value: function(entryID, description, userInfo) {
                // No animation handling at this time
                return true;
            }
        },

        handleIndices: {
            value: function(entryID, description, userInfo) {
        		// Save indices entry
        		description.id = entryID;
        		this.resources.setEntry(entryID, null, description);
                return true;
            }
        },

        handleAttribute: {
            value: function(entryID, description, userInfo) {
	    		// Save attribute entry
	    		this.resources.setEntry(entryID, description, description);
                return true;
            }
        },
        
        handleError: {
            value: function(msg) {

        		throw new Error(msg);
        		return true;
        	}
        },
        
        _delegate: {
            value: new LoadDelegate,
            writable: true
        },

        delegate: {
            enumerable: true,
            get: function() {
                return this._delegate;
            },
            set: function(value) {
                this._delegate = value;
            }
        }
    });


    // Loader

    var Context = function(rootObj, callback) {
        this.rootObj = rootObj;
        this.callback = callback;
    };

    return {
    	load : function( url, callback ) {
	        var rootObj = new THREE.Object3D();
	
	        var loader = Object.create(ThreeGLTFLoader);
	            loader.initWithPath(url);
	            loader.load(new Context(rootObj, callback) /* userInfo */, null /* options */);
	
	        return rootObj;
    	}
    };
}

THREE.glTFLoader.prototype = new THREE.Loader();
THREE.glTFLoader.prototype.constructor = THREE.glTFLoader;

