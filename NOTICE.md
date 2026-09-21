# Third-party material

WoT Lab's own code and Thing Models are licensed under the [AGPL-3.0](LICENSE). Two of the bundled
benchmark environments are derived from other people's work, listed here with their terms.

## `ibm-building3`, `ibm-building3-small`

`src/environments/ibm-building3.json`, `src/environments/ibm-building3-small.json`, the `rooms.json`
beside each, and the `src/things/b3-*` Thing Models are derived from the Brick model of IBM Research
Building 3 in Dublin, `building_instances/IBM_B3.ttl` at commit `2e48662` of
<https://github.com/BuildSysUniformMetadata/GroundTruth>. The rooms, the points in them and the
`brick:` statements on each Thing come from that model; the Thing Descriptions, state and effects
were written for WoT Lab. The source is distributed under the following licence:

```
Copyright (c) 2016, Brick Development Team
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

  1. Redistributions of source code must retain the above copyright
     notice, this list of conditions and the following disclaimer.

  2. Redistributions in binary form must reproduce the above
     copyright notice, this list of conditions and the following
     disclaimer in the documentation and/or other materials provided
     with the distribution.

  3. Neither the name of the copyright holder nor the names of any
     contributors may be used to endorse or promote products derived
     from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## `mosaik`

`src/environments/mosaik.json`, `src/environments/mosaik/` and the `src/things/mosaik-*` Thing Models
model the modular-smartphone shopfloor of the MOSAIK project — its products, workstations, recipes
and grid:

> V. Charpenay et al., "MOSAIK: A Formal Model for Self-Organizing Manufacturing Systems,"
> IEEE Pervasive Computing, 2021. <https://doi.org/10.1109/MPRV.2020.3035837>
